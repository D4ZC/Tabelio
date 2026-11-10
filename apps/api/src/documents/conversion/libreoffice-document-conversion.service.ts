import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DocumentConversionFailedError,
  DocumentConversionPort,
  DocumentConversionUnavailableError,
  type DocumentConversionResult,
} from './document-conversion.port';

@Injectable()
export class LibreOfficeDocumentConversionService implements DocumentConversionPort {
  private readonly binary: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.binary = config.get('LIBREOFFICE_BIN', 'soffice');
    const configuredTimeout = Number(config.get('PDF_CONVERSION_TIMEOUT_MS', '60000'));
    this.timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : 60_000;
  }

  async convertDocxToPdf(input: {
    documentId: string;
    buffer: Buffer;
  }): Promise<DocumentConversionResult> {
    const directory = await mkdtemp(join(tmpdir(), 'despacho-pdf-'));
    const profileDirectory = join(directory, 'libreoffice-profile');
    const inputPath = join(directory, `${input.documentId}.docx`);
    const outputPath = join(directory, `${input.documentId}.pdf`);

    try {
      await mkdir(profileDirectory);
      await writeFile(inputPath, input.buffer, { flag: 'wx' });
      await this.runLibreOffice(inputPath, directory, profileDirectory);
      const buffer = await readFile(outputPath).catch(() => undefined);
      if (!buffer?.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new DocumentConversionFailedError('LibreOffice no produjo un PDF válido');
      }
      return { buffer, provider: 'libreoffice' };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private runLibreOffice(inputPath: string, outputDirectory: string, profileDirectory: string) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.binary, [
        `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
        '--headless',
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        outputDirectory,
        inputPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let settled = false;
      let output = '';
      const append = (chunk: Buffer) => {
        if (output.length < 8_000) output += chunk.toString('utf8');
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new DocumentConversionFailedError(
          `La conversión excedió ${Math.round(this.timeoutMs / 1000)} segundos`,
        ));
      }, this.timeoutMs);

      child.once('error', (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error.code === 'ENOENT') {
          reject(new DocumentConversionUnavailableError(
            `No se encontró LibreOffice en ${this.binary}. Configura LIBREOFFICE_BIN`,
          ));
          return;
        }
        reject(new DocumentConversionFailedError(error.message));
      });
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new DocumentConversionFailedError(
          `LibreOffice terminó con código ${code ?? 'desconocido'}${output.trim() ? `: ${output.trim()}` : ''}`,
        ));
      });
    });
  }
}
