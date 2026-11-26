import {
  Inject,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  StreamableFile,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'node:stream';
import {
  DOCUMENT_CONVERSION,
  DocumentConversionFailedError,
  DocumentConversionUnavailableError,
  type DocumentConversionPort,
} from '../conversion/document-conversion.port';

const MB = 1024 * 1024;

/**
 * Tipos que el navegador muestra por sí mismo. Se excluyen deliberadamente HTML,
 * SVG y cualquier formato capaz de ejecutar scripts dentro del origen de la app.
 */
const INLINE_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg',
]);

/** Formatos legibles como texto. Siempre se entregan como text/plain para que nunca se interpreten. */
const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'text/xml', 'application/xml', 'application/json']);

/** Formatos de oficina que LibreOffice convierte a PDF, con la extensión que necesita para detectarlos. */
const CONVERTIBLE_TYPES: Record<string, string> = {
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
};

/** Respaldo por extensión cuando el tipo almacenado es genérico (application/octet-stream o vacío). */
const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  txt: 'text/plain', csv: 'text/csv', xml: 'application/xml', json: 'application/json',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export type PreviewPlan =
  | { mode: 'inline'; contentType: string }
  | { mode: 'text' }
  | { mode: 'convert'; extension: string }
  | { mode: 'none' };

export function previewPlan(mimeType: string | null | undefined, fileName: string): PreviewPlan {
  let type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (GENERIC_TYPES.has(type)) {
    const extension = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
    type = EXTENSION_TYPES[extension] ?? type;
  }
  if (INLINE_TYPES.has(type)) return { mode: 'inline', contentType: type };
  if (TEXT_TYPES.has(type)) return { mode: 'text' };
  const extension = CONVERTIBLE_TYPES[type];
  if (extension) return { mode: 'convert', extension };
  return { mode: 'none' };
}

export interface PreviewSource {
  /** Identifica el contenido exacto (id + checksum) para reutilizar conversiones. */
  cacheKey: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  open: () => Promise<Readable>;
}

export interface PreviewContent {
  body: Readable | Buffer;
  contentType: string;
  sizeBytes: number;
  fileName: string;
}

/**
 * Respuesta `inline` para la vista previa. La política `sandbox` impide que el archivo
 * ejecute scripts con el origen de la API aunque alguien lo abra directamente.
 */
export function previewFile(content: PreviewContent) {
  const encodedName = encodeURIComponent(content.fileName).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  const options = {
    type: content.contentType,
    disposition: `inline; filename*=UTF-8''${encodedName}`,
    length: content.sizeBytes,
  };
  return Buffer.isBuffer(content.body)
    ? new StreamableFile(content.body, options)
    : new StreamableFile(content.body, options);
}

export const PREVIEW_SECURITY_HEADERS = {
  'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'private, no-store',
} as const;

@Injectable()
export class DocumentPreviewService {
  private readonly cache = new Map<string, Buffer>();
  private cacheBytes = 0;
  private readonly inflight = new Map<string, Promise<Buffer>>();
  private activeConversions = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly maxCacheBytes: number;
  private readonly maxConvertBytes: number;
  private readonly maxTextBytes: number;
  private readonly maxConcurrentConversions: number;

  constructor(
    @Inject(DOCUMENT_CONVERSION) private readonly conversion: DocumentConversionPort,
    config: ConfigService,
  ) {
    this.maxCacheBytes = positive(config.get('PREVIEW_CACHE_MB'), 200) * MB;
    this.maxConvertBytes = positive(config.get('PREVIEW_MAX_CONVERT_MB'), 40) * MB;
    this.maxTextBytes = positive(config.get('PREVIEW_MAX_TEXT_MB'), 5) * MB;
    this.maxConcurrentConversions = positive(config.get('PREVIEW_MAX_CONCURRENT_CONVERSIONS'), 2);
  }

  /** Valida el tipo antes de registrar auditoría o abrir el archivo. */
  plan(source: Pick<PreviewSource, 'mimeType' | 'fileName' | 'sizeBytes'>): Exclude<PreviewPlan, { mode: 'none' }> {
    const plan = previewPlan(source.mimeType, source.fileName);
    if (plan.mode === 'none') {
      throw new UnsupportedMediaTypeException('Este tipo de archivo no tiene vista previa. Descárgalo para abrirlo.');
    }
    if (plan.mode === 'text' && source.sizeBytes > this.maxTextBytes) {
      throw new PayloadTooLargeException('El archivo de texto es demasiado grande para la vista previa. Descárgalo para abrirlo.');
    }
    if (plan.mode === 'convert' && source.sizeBytes > this.maxConvertBytes) {
      throw new PayloadTooLargeException('El archivo es demasiado grande para convertirlo en vista previa. Descárgalo para abrirlo.');
    }
    return plan;
  }

  async render(source: PreviewSource): Promise<PreviewContent> {
    const plan = this.plan(source);
    if (plan.mode === 'inline') {
      return { body: await source.open(), contentType: plan.contentType, sizeBytes: source.sizeBytes, fileName: source.fileName };
    }
    if (plan.mode === 'text') {
      return { body: await source.open(), contentType: 'text/plain; charset=utf-8', sizeBytes: source.sizeBytes, fileName: source.fileName };
    }
    const pdf = await this.converted(source, plan.extension);
    return {
      body: pdf,
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
      fileName: source.fileName.replace(/\.[^./\\]+$/, '') + '.pdf',
    };
  }

  private converted(source: PreviewSource, extension: string): Promise<Buffer> {
    const cached = this.cache.get(source.cacheKey);
    if (cached) {
      // Reinsertar mantiene el orden LRU del Map.
      this.cache.delete(source.cacheKey);
      this.cache.set(source.cacheKey, cached);
      return Promise.resolve(cached);
    }
    const pending = this.inflight.get(source.cacheKey);
    if (pending) return pending;

    const job = this.withConversionSlot(async () => {
      const input = await readAll(await source.open(), this.maxConvertBytes);
      try {
        const { buffer } = await this.conversion.convertToPdf({ documentId: source.cacheKey, buffer: input, extension });
        return buffer;
      } catch (error) {
        if (error instanceof DocumentConversionUnavailableError) throw new ServiceUnavailableException(error.message);
        if (error instanceof DocumentConversionFailedError) {
          throw new InternalServerErrorException(`No fue posible preparar la vista previa: ${error.message}`);
        }
        throw error;
      }
    }).then((buffer) => {
      this.remember(source.cacheKey, buffer);
      return buffer;
    }).finally(() => this.inflight.delete(source.cacheKey));
    this.inflight.set(source.cacheKey, job);
    return job;
  }

  private remember(key: string, buffer: Buffer) {
    if (buffer.length > this.maxCacheBytes) return;
    this.cache.set(key, buffer);
    this.cacheBytes += buffer.length;
    for (const [oldestKey, oldest] of this.cache) {
      if (this.cacheBytes <= this.maxCacheBytes) break;
      this.cache.delete(oldestKey);
      this.cacheBytes -= oldest.length;
    }
  }

  private async withConversionSlot<T>(work: () => Promise<T>): Promise<T> {
    while (this.activeConversions >= this.maxConcurrentConversions) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.activeConversions += 1;
    try {
      return await work();
    } finally {
      this.activeConversions -= 1;
      this.waiting.shift()?.();
    }
  }
}

function positive(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readAll(stream: Readable, limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      stream.destroy();
      throw new PayloadTooLargeException('El archivo es demasiado grande para convertirlo en vista previa. Descárgalo para abrirlo.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
