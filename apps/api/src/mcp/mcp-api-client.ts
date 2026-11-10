import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { McpOperation } from './operation-catalog';
import { USAGE_CONTEXT_HEADER } from '../ai-usage/usage-correlation.service';

interface LocalFileInput {
  path: string;
  field?: string;
  mimeType?: string;
}

export interface McpToolInput {
  params?: Record<string, string | number | boolean>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  files?: LocalFileInput[];
  outputPath?: string;
}

@Injectable()
export class McpApiClient {
  private readonly apiBaseUrl: string;
  private readonly outputDirectory: string;
  private readonly maxUploadBytes: number;
  private readonly maxDownloadBytes: number;

  constructor(private readonly config: ConfigService) {
    const port = this.config.get('API_PORT', '4000');
    this.apiBaseUrl = this.config
      .get('MCP_INTERNAL_API_URL', `http://127.0.0.1:${port}/api`)
      .replace(/\/$/, '');
    const internalUrl = new URL(this.apiBaseUrl);
    if (!['http:', 'https:'].includes(internalUrl.protocol)) {
      throw new Error('MCP_INTERNAL_API_URL debe usar HTTP o HTTPS.');
    }
    if (
      this.config.get('MCP_LOCAL_ONLY', 'true') === 'true'
      && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(internalUrl.hostname)
    ) {
      throw new Error('MCP_INTERNAL_API_URL debe apuntar a loopback cuando MCP_LOCAL_ONLY=true.');
    }
    this.outputDirectory = resolve(this.config.get('MCP_OUTPUT_DIR', './tmp/mcp-downloads'));
    this.maxUploadBytes = this.positiveInteger('MCP_MAX_UPLOAD_BYTES', 20 * 1024 * 1024);
    this.maxDownloadBytes = this.positiveInteger('MCP_MAX_DOWNLOAD_BYTES', 50 * 1024 * 1024);
  }

  async call(
    operation: McpOperation,
    input: McpToolInput,
    accessToken: string,
    usageContext?: string,
  ): Promise<CallToolResult> {
    try {
      const url = this.createUrl(operation, input);
      const request = await this.createRequest(operation, input, accessToken);
      if (usageContext) {
        const headers = new Headers(request.headers);
        headers.set(USAGE_CONTEXT_HEADER, usageContext);
        request.headers = headers;
      }
      const response = await fetch(url, request);

      if (!response.ok) return this.errorResult(response);
      if (operation.returnsFile || this.isFileResponse(response)) {
        return this.saveFileResponse(operation, input, response);
      }
      return this.dataResult(response);
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: error instanceof Error ? error.message : 'La operación MCP no pudo completarse.',
        }],
      };
    }
  }

  private createUrl(operation: McpOperation, input: McpToolInput) {
    const renderedPath = operation.apiPath.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
      const value = input.params?.[name];
      if (value === undefined || value === null || String(value).trim() === '') {
        throw new Error(`Falta el parámetro de ruta ${name}.`);
      }
      return encodeURIComponent(String(value));
    });
    const url = new URL(`${this.apiBaseUrl}/${renderedPath}`);
    for (const [name, rawValue] of Object.entries(input.query ?? {})) {
      if (rawValue === undefined || rawValue === null || rawValue === '') continue;
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        url.searchParams.append(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
    }
    return url;
  }

  private async createRequest(
    operation: McpOperation,
    input: McpToolInput,
    accessToken: string,
  ): Promise<RequestInit> {
    const headers = new Headers({
      Accept: 'application/json, text/csv, application/octet-stream',
      Authorization: `Bearer ${accessToken}`,
    });
    let body: BodyInit | undefined;

    if (operation.acceptsFiles) {
      const files = input.files ?? [];
      if (files.length === 0) throw new Error('La operación requiere al menos un archivo local.');
      const form = new FormData();
      this.appendMultipartBody(form, input.body ?? {});
      for (const file of files) {
        const filePath = isAbsolute(file.path) ? file.path : resolve(file.path);
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) throw new Error(`La ruta no es un archivo: ${file.path}`);
        if (fileStat.size > this.maxUploadBytes) {
          throw new Error(`El archivo ${file.path} supera el límite MCP de ${this.maxUploadBytes} bytes.`);
        }
        const bytes = await readFile(filePath);
        const field = file.field ?? (operation.multipleFiles ? 'files' : 'file');
        form.append(field, new Blob([bytes], {
          type: file.mimeType ?? 'application/octet-stream',
        }), basename(filePath));
      }
      body = form;
    } else if (input.body !== undefined && !['GET', 'HEAD'].includes(operation.method)) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(input.body);
    }

    return {
      method: operation.method,
      headers,
      body,
      redirect: 'error',
    };
  }

  private appendMultipartBody(form: FormData, body: Record<string, unknown>) {
    for (const [name, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      form.append(name, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }

  private async dataResult(response: Response): Promise<CallToolResult> {
    const contentType = response.headers.get('content-type') ?? '';
    const raw = await response.text();
    if (!raw) return { content: [{ type: 'text', text: 'Operación completada.' }] };

    if (contentType.includes('application/json')) {
      const data = JSON.parse(raw) as unknown;
      const text = JSON.stringify(data, null, 2);
      return {
        structuredContent: { result: data },
        content: [{
          type: 'text',
          text: text.length <= 30_000
            ? text
            : `${text.slice(0, 30_000)}\n… resultado truncado en texto; structuredContent conserva los datos completos.`,
        }],
      };
    }
    return { content: [{ type: 'text', text: raw }] };
  }

  private async errorResult(response: Response): Promise<CallToolResult> {
    const raw = await response.text();
    let message = raw || `La aplicación respondió con HTTP ${response.status}.`;
    try {
      const payload = JSON.parse(raw) as { message?: string | string[]; error?: string };
      const detail = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
      message = detail ?? payload.error ?? message;
    } catch {
      // Conserva el texto original cuando la respuesta no es JSON.
    }
    return {
      isError: true,
      structuredContent: {
        error: {
          status: response.status,
          message,
          requestId: response.headers.get('x-request-id'),
        },
      },
      content: [{ type: 'text', text: `HTTP ${response.status}: ${message}` }],
    };
  }

  private async saveFileResponse(
    operation: McpOperation,
    input: McpToolInput,
    response: Response,
  ): Promise<CallToolResult> {
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > this.maxDownloadBytes) {
      throw new Error(`La descarga supera el límite MCP de ${this.maxDownloadBytes} bytes.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > this.maxDownloadBytes) {
      throw new Error(`La descarga supera el límite MCP de ${this.maxDownloadBytes} bytes.`);
    }

    const responseName = this.responseFileName(response) ?? `${operation.handlerName}-${Date.now()}`;
    const requestedPath = input.outputPath
      ? (isAbsolute(input.outputPath) ? input.outputPath : resolve(input.outputPath))
      : resolve(this.outputDirectory, `${Date.now()}-${responseName}`);
    let targetPath = requestedPath;
    try {
      if ((await stat(requestedPath)).isDirectory()) targetPath = resolve(requestedPath, responseName);
    } catch {
      // Una ruta inexistente se interpreta como el archivo de destino.
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, bytes, { flag: 'wx' });

    const result = {
      path: targetPath,
      fileName: basename(targetPath),
      mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
      sizeBytes: bytes.byteLength,
    };
    return {
      structuredContent: result,
      content: [{ type: 'text', text: `Archivo guardado en ${targetPath} (${bytes.byteLength} bytes).` }],
    };
  }

  private isFileResponse(response: Response) {
    const contentType = response.headers.get('content-type') ?? '';
    const disposition = response.headers.get('content-disposition') ?? '';
    return disposition.includes('attachment') || disposition.includes('inline') || contentType.includes('text/csv');
  }

  private responseFileName(response: Response) {
    const disposition = response.headers.get('content-disposition') ?? '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    let candidate = encoded ?? plain;
    if (candidate) {
      try {
        candidate = decodeURIComponent(candidate);
      } catch {
        // Usa el nombre sin decodificar si contiene una secuencia inválida.
      }
    }
    candidate = basename(candidate ?? '').replace(/[^\p{L}\p{N}._ -]/gu, '_');
    return candidate || undefined;
  }

  private positiveInteger(name: string, fallback: number) {
    const value = Number(this.config.get(name, String(fallback)));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
