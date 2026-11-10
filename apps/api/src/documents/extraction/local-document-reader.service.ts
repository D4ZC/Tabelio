import { BadRequestException, Inject, Injectable, Optional, RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { localDocumentFields, type LocalDocumentKind } from './local-document-fields';

export type LocalDocumentReadResult = {
  documentKind: LocalDocumentKind;
  data: Record<string, string>;
  text: string;
  method: 'pdf-text' | 'ocr' | 'mixed';
  message: string;
};

export interface LocalDocumentCommandRunner {
  run(binary: string, args: string[], options: { timeoutMs: number; maxBuffer: number }): Promise<{ stdout: Buffer | string }>;
}

export const LOCAL_DOCUMENT_COMMAND_RUNNER = Symbol('LOCAL_DOCUMENT_COMMAND_RUNNER');
const MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 30_000;
const MAX_RASTER_BYTES = 32 * 1024 * 1024;
const MAX_COMMAND_OUTPUT = 256 * 1024;

const nativeRunner: LocalDocumentCommandRunner = {
  run(binary, args, options) {
    return new Promise((resolve, reject) => {
      execFile(binary, args, {
        timeout: options.timeoutMs, maxBuffer: options.maxBuffer, encoding: 'buffer',
        killSignal: 'SIGKILL', shell: false, windowsHide: true,
        env: { ...process.env, LC_ALL: 'C', OMP_THREAD_LIMIT: '1' },
      }, (error, stdout) => error ? reject(error) : resolve({ stdout }));
    });
  },
};

@Injectable()
export class LocalDocumentReaderService {
  private activeReads = 0;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(LOCAL_DOCUMENT_COMMAND_RUNNER) private readonly runner?: LocalDocumentCommandRunner,
  ) {}

  settings() {
    return {
      enabled: this.config.get('LOCAL_OCR_ENABLED', 'true') === 'true', provider: 'local' as const,
      supportedMimeTypes: [...MIME_TYPES], maxBytes: MAX_BYTES,
      maxPages: this.integer('LOCAL_OCR_MAX_PAGES', 20, 20), maxTextCharacters: MAX_TEXT,
      timeoutMs: this.integer('LOCAL_OCR_TIMEOUT_MS', 90_000, 90_000),
    };
  }

  async read(buffer: Buffer, mimeType: string): Promise<LocalDocumentReadResult> {
    const settings = this.settings();
    if (!settings.enabled) throw new ServiceUnavailableException('La lectura local de documentos está deshabilitada.');
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) {
      throw new BadRequestException('El archivo debe contener datos y no superar 20 MB.');
    }
    if (!MIME_TYPES.includes(mimeType)) throw new BadRequestException('La lectura local admite PDF, JPG o PNG.');
    this.assertSignature(buffer, mimeType);
    if (this.activeReads >= 2) throw new ServiceUnavailableException('Hay otras lecturas locales en curso. Intenta de nuevo en unos momentos.');
    this.activeReads += 1;
    const deadline = Date.now() + settings.timeoutMs;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), 'despacho-local-read-'));
      await chmod(directory, 0o700);
      let text = '';
      let truncated = false;
      let textPages = 0;
      let ocrPages = 0;
      const append = (value: string) => {
        const normalized = cleanText(value);
        if (!normalized) return;
        const addition = `${text ? '\n\n' : ''}${normalized}`;
        if (text.length + addition.length > MAX_TEXT) truncated = true;
        text += addition.slice(0, Math.max(0, MAX_TEXT - text.length));
      };
      if (mimeType === 'application/pdf') {
        const input = join(directory, 'source.pdf');
        await writeFile(input, buffer, { mode: 0o600 });
        const info = await this.command('PDFINFO', ['-isodates', input], deadline);
        if (/^\s*Encrypted:\s+yes\b/mi.test(info)) throw new BadRequestException('El PDF está protegido. Utiliza una copia sin contraseña para leerlo localmente.');
        const pages = Number(info.match(/^\s*Pages:\s+(\d+)\s*$/mi)?.[1]);
        if (!Number.isSafeInteger(pages) || pages < 1) throw new BadRequestException('No fue posible identificar las páginas del PDF.');
        if (pages > settings.maxPages) throw new BadRequestException(`La lectura local admite hasta ${settings.maxPages} páginas por PDF. Divide el documento antes de volver a intentarlo.`);
        for (let page = 1; page <= pages; page++) {
          const embedded = await this.command('PDFTOTEXT', ['-f', String(page), '-l', String(page), '-layout', '-enc', 'UTF-8', '-nopgbrk', input, '-'], deadline);
          if (sufficientText(embedded)) {
            textPages += 1;
            append(embedded);
          } else {
            const prefix = join(directory, `page-${page}`);
            await this.command('PDFTOPPM', ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '2400', '-r', '150', '-png', input, prefix], deadline);
            const image = `${prefix}.png`;
            const imageInfo = await stat(image);
            if (!imageInfo.isFile() || imageInfo.size > MAX_RASTER_BYTES) throw new BadRequestException('La página produce una imagen demasiado grande para la lectura local.');
            const recognized = await this.ocr(image, deadline);
            ocrPages += 1;
            append(recognized.trim() ? recognized : embedded);
            await rm(image, { force: true });
          }
        }
      } else {
        const image = join(directory, 'source.png');
        let normalized: Buffer;
        try {
          normalized = await sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error', pages: 1 })
            .rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
            .png().timeout({ seconds: Math.max(1, Math.floor(this.remaining(deadline) / 1000)) }).toBuffer();
        } catch {
          this.remaining(deadline);
          throw new BadRequestException('No fue posible preparar la imagen. Usa una copia legible de hasta 40 megapíxeles.');
        }
        this.remaining(deadline);
        if (normalized.length > MAX_RASTER_BYTES) throw new BadRequestException('La imagen preparada supera el límite de lectura local.');
        await writeFile(image, normalized, { mode: 0o600 });
        append(await this.ocr(image, deadline));
        ocrPages = 1;
      }
      this.remaining(deadline);
      const method = textPages && ocrPages ? 'mixed' : ocrPages ? 'ocr' : 'pdf-text';
      const fields = localDocumentFields(text);
      const message = fields.documentKind === 'UNREADABLE'
        ? 'No se obtuvo texto legible. Prueba una copia más clara o captura los datos manualmente.'
        : `Lectura local ${method === 'pdf-text' ? 'del texto del PDF' : method === 'mixed' ? 'del texto del PDF y mediante OCR' : 'mediante OCR'}. Revisa el texto y los campos contra el original; esta lectura no verifica autenticidad.`;
      return {
        ...fields, text, method,
        message: `${message} No se utilizó IA ni se realizaron llamadas externas.${truncated ? ` Se muestran los primeros ${MAX_TEXT} caracteres; el texto fue truncado.` : ''}`,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException || error instanceof RequestTimeoutException) throw error;
      throw new BadRequestException('No fue posible completar la lectura local del archivo. Utiliza una copia legible e intenta de nuevo.');
    } finally {
      this.activeReads -= 1;
      if (directory) {
        try { await rm(directory, { recursive: true, force: true }); }
        catch { throw new ServiceUnavailableException('No fue posible limpiar los archivos temporales de la lectura local.'); }
      }
    }
  }

  private ocr(image: string, deadline: number) {
    const configured = this.config.get('LOCAL_OCR_LANGUAGE', 'spa+eng').trim();
    const language = /^[a-z][a-z0-9_]*(?:\+[a-z][a-z0-9_]*)*$/.test(configured) && configured.length <= 80 ? configured : 'spa+eng';
    return this.command('TESSERACT', [image, 'stdout', '-l', language, '--psm', '3'], deadline);
  }

  private async command(name: 'PDFINFO' | 'PDFTOTEXT' | 'PDFTOPPM' | 'TESSERACT', args: string[], deadline: number) {
    const defaults = { PDFINFO: 'pdfinfo', PDFTOTEXT: 'pdftotext', PDFTOPPM: 'pdftoppm', TESSERACT: 'tesseract' };
    try {
      const result = await (this.runner ?? nativeRunner).run(
        this.config.get(`LOCAL_OCR_${name}_BIN`, defaults[name]), args,
        { timeoutMs: this.remaining(deadline), maxBuffer: MAX_COMMAND_OUTPUT },
      );
      this.remaining(deadline);
      const output = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
      if (output.length > MAX_COMMAND_OUTPUT) throw new BadRequestException('El documento produce demasiado texto para la lectura local. Divide el archivo e intenta de nuevo.');
      return output.toString('utf8');
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof RequestTimeoutException) throw error;
      const details = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
      if (details.code === 'ENOENT') throw new ServiceUnavailableException(`Falta instalar ${name === 'TESSERACT' ? 'Tesseract con español' : 'Poppler'} para la lectura local.`);
      if (details.killed || details.signal || details.code === 'ETIMEDOUT') throw new RequestTimeoutException('La lectura local superó el tiempo permitido. Usa un documento más pequeño o una imagen más clara.');
      if (details.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new BadRequestException('El documento produce demasiado texto para la lectura local. Divide el archivo e intenta de nuevo.');
      throw new BadRequestException(name === 'TESSERACT'
        ? 'No fue posible completar el OCR local. Comprueba que Tesseract tenga instalados español e inglés y utiliza una copia legible.'
        : 'No fue posible leer el PDF localmente. Comprueba que no esté dañado ni protegido con contraseña.');
    }
  }

  private remaining(deadline: number) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new RequestTimeoutException('La lectura local superó el tiempo permitido.');
    return Math.max(1, remaining);
  }

  private integer(key: string, fallback: number, maximum: number) {
    const value = Number(this.config.get(key, String(fallback)));
    return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
  }

  private assertSignature(buffer: Buffer, mimeType: string) {
    const valid = mimeType === 'application/pdf' ? buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))
      : mimeType === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    if (!valid) throw new BadRequestException('El contenido del archivo no corresponde al tipo PDF, JPG o PNG indicado.');
  }
}

function cleanText(text: string) {
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

function sufficientText(text: string) {
  const cleaned = cleanText(text);
  return (cleaned.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 40
    && (cleaned.match(/[\p{L}\p{N}]{2,}/gu)?.length ?? 0) >= 6;
}
