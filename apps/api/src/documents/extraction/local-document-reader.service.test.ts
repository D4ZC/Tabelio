import { ConfigService } from '@nestjs/config';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalDocumentReaderService, type LocalDocumentCommandRunner } from './local-document-reader.service';

const pdf = Buffer.from('%PDF-1.4\nsynthetic fixture; command output is mocked\n');
const pageText = 'Documento sintético con texto suficiente para lectura local sin reconocimiento de imágenes ni servicios externos.';
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=', 'base64');

function setup(options: {
  pages?: number;
  text?: (page: number) => string;
  ocr?: string;
  execute?: LocalDocumentCommandRunner['run'];
  config?: Record<string, string>;
} = {}) {
  const paths: string[] = [];
  const run = vi.fn<LocalDocumentCommandRunner['run']>(async (binary, args, limits) => {
    if (binary === 'pdfinfo') paths.push(args.at(-1)!);
    if (options.execute) return options.execute(binary, args, limits);
    if (binary === 'pdfinfo') return { stdout: `Pages: ${options.pages ?? 1}\nEncrypted: no\n` };
    if (binary === 'pdftotext') return { stdout: options.text?.(Number(args[1])) ?? pageText };
    if (binary === 'pdftoppm') { await writeFile(`${args.at(-1)}.png`, tinyPng, { mode: 0o600 }); return { stdout: '' }; }
    if (binary === 'tesseract') { paths.push(args[0]); return { stdout: options.ocr ?? 'Texto sintético reconocido de la imagen del documento.' }; }
    throw new Error('unexpected binary');
  });
  const service = new LocalDocumentReaderService(new ConfigService(options.config ?? {}), { run });
  return { service, run, paths };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('lectura local PDF y OCR', () => {
  it('lee texto del PDF sin OCR ni red y elimina archivos temporales privados', async () => {
    const fetchMock = vi.fn(() => { throw new Error('no network allowed'); });
    vi.stubGlobal('fetch', fetchMock);
    const { service, run, paths } = setup();
    const result = await service.read(pdf, 'application/pdf');
    expect(result).toMatchObject({ method: 'pdf-text', documentKind: 'OTHER', data: {}, text: pageText });
    expect(result.message).toContain('No se utilizó IA');
    expect(run.mock.calls.map(([binary]) => binary)).toEqual(['pdfinfo', 'pdftotext']);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(access(dirname(paths[0]))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('usa OCR solamente en páginas sin texto suficiente y combina el PDF mixto', async () => {
    const { service, run, paths } = setup({ pages: 2, text: (page) => page === 1 ? pageText : 'I', ocr: 'SEGUNDA PAGINA TEXTO OCR SINTETICO' });
    const result = await service.read(pdf, 'application/pdf');
    expect(result.method).toBe('mixed');
    expect(result.text).toContain(pageText);
    expect(result.text).toContain('SEGUNDA PAGINA');
    const raster = run.mock.calls.find(([binary]) => binary === 'pdftoppm')!;
    expect(raster[1].slice(0, 4)).toEqual(['-f', '2', '-l', '2']);
    expect(raster[1]).toContain('2400');
    expect(run.mock.calls.filter(([binary]) => binary === 'tesseract')).toHaveLength(1);
    await expect(access(dirname(paths[0]))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('PDF escaneado usa OCR y no descarta texto breve si OCR queda vacío', async () => {
    const ocr = setup({ text: () => '', ocr: 'Texto recuperado mediante reconocimiento local' });
    expect((await ocr.service.read(pdf, 'application/pdf')).method).toBe('ocr');
    const blank = setup({ text: () => 'Hola', ocr: '' });
    expect((await blank.service.read(pdf, 'application/pdf')).text).toBe('Hola');
  });

  it('normaliza una imagen a máximo 2400px antes del OCR y conserva permisos privados', async () => {
    const image = await sharp({ create: { width: 3500, height: 1000, channels: 3, background: '#fff' } }).png().toBuffer();
    let imagePath = '';
    const { service } = setup({ execute: async (binary, args) => {
      expect(binary).toBe('tesseract');
      imagePath = args[0];
      const metadata = await sharp(await readFile(imagePath)).metadata();
      expect(metadata.width).toBe(2400);
      expect(metadata.height!).toBeLessThanOrEqual(2400);
      expect((await stat(dirname(imagePath))).mode & 0o777).toBe(0o700);
      expect((await stat(imagePath)).mode & 0o777).toBe(0o600);
      return { stdout: pageText };
    } });
    expect((await service.read(image, 'image/png')).method).toBe('ocr');
    await expect(access(dirname(imagePath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechaza archivos vacíos, grandes, tipo inválido y contenido disfrazado antes de lanzar comandos', async () => {
    const { service, run } = setup();
    await expect(service.read(Buffer.alloc(0), 'application/pdf')).rejects.toThrow('20 MB');
    await expect(service.read(Buffer.alloc(20 * 1024 * 1024 + 1), 'application/pdf')).rejects.toThrow('20 MB');
    await expect(service.read(pdf, 'text/plain')).rejects.toThrow('PDF, JPG o PNG');
    await expect(service.read(Buffer.from('not a pdf'), 'application/pdf')).rejects.toThrow('no corresponde');
    expect(run).not.toHaveBeenCalled();
  });

  it('rechaza PDF de más de20 páginas o protegido y limpia los temporales', async () => {
    const oversized = setup({ pages: 21 });
    await expect(oversized.service.read(pdf, 'application/pdf')).rejects.toThrow('20 páginas');
    expect(oversized.run).toHaveBeenCalledOnce();
    await expect(access(dirname(oversized.paths[0]))).rejects.toMatchObject({ code: 'ENOENT' });
    const protectedPdf = setup({ execute: async () => ({ stdout: 'Pages: 1\nEncrypted: yes (print:yes)' }) });
    await expect(protectedPdf.service.read(pdf, 'application/pdf')).rejects.toThrow('protegido');
  });

  it('trunca la salida visible a30000 caracteres con aviso y limita buffers CLI', async () => {
    const { service, run } = setup({ text: () => pageText.repeat(400) });
    const result = await service.read(pdf, 'application/pdf');
    expect(result.text).toHaveLength(30_000);
    expect(result.message).toContain('truncado');
    expect(run.mock.calls.every(([, , options]) => options.maxBuffer <= 262144 && options.timeoutMs <= 90000)).toBe(true);
    const excessive = setup({ text: () => 'a'.repeat(262145) });
    await expect(excessive.service.read(pdf, 'application/pdf')).rejects.toThrow('demasiado texto');
  });

  it('no filtra errores de CLI ni contenido documental y limpia tras fallo', async () => {
    const { service, paths } = setup({ execute: async () => { throw new Error('SECRET DOCUMENT CONTENT'); } });
    let error: unknown;
    try { await service.read(pdf, 'application/pdf'); } catch (failure) { error = failure; }
    expect(String(error)).toContain('No fue posible leer el PDF');
    expect(String(error)).not.toContain('SECRET DOCUMENT CONTENT');
    await expect(access(dirname(paths[0]))).rejects.toMatchObject({ code: 'ENOENT' });
    const missing = setup({ execute: async () => { throw Object.assign(new Error('private path'), { code: 'ENOENT' }); } });
    await expect(missing.service.read(pdf, 'application/pdf')).rejects.toThrow('Poppler');
  });

  it('respeta timeout global y señala procesos cancelados sin fallback externo', async () => {
    const { service } = setup({ execute: async () => { throw Object.assign(new Error('private'), { killed: true }); } });
    await expect(service.read(pdf, 'application/pdf')).rejects.toThrow('tiempo permitido');
    let calls = 0;
    const started = Date.now();
    const timed = setup({ config: { LOCAL_OCR_TIMEOUT_MS: '50' }, execute: async () => {
      calls += 1;
      vi.spyOn(Date, 'now').mockReturnValue(started + 1000);
      return { stdout: 'Pages: 1' };
    } });
    await expect(timed.service.read(pdf, 'application/pdf')).rejects.toThrow('tiempo permitido');
    expect(calls).toBe(1);
  });

  it('admite como máximo dos lecturas concurrentes y libera el cupo al terminar', async () => {
    let open = 0;
    let ready!: () => void;
    const bothStarted = new Promise<void>((resolve) => { ready = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { service } = setup({ execute: async (binary) => {
      if (binary === 'pdfinfo') { if (++open === 2) ready(); await gate; return { stdout: 'Pages: 1' }; }
      return { stdout: pageText };
    } });
    const first = service.read(pdf, 'application/pdf');
    const second = service.read(pdf, 'application/pdf');
    await bothStarted;
    await expect(service.read(pdf, 'application/pdf')).rejects.toThrow('otras lecturas locales');
    release();
    await Promise.all([first, second]);
    expect((await service.read(pdf, 'application/pdf')).method).toBe('pdf-text');
  });

  it('configuración no amplía límites duros y puede deshabilitar el motor', async () => {
    const capped = setup({ config: { LOCAL_OCR_MAX_PAGES: '100', LOCAL_OCR_TIMEOUT_MS: '200000' } });
    expect(capped.service.settings()).toMatchObject({ maxPages: 20, timeoutMs: 90000, provider: 'local' });
    const disabled = setup({ config: { LOCAL_OCR_ENABLED: 'false' } });
    await expect(disabled.service.read(pdf, 'application/pdf')).rejects.toThrow('deshabilitada');
    expect(disabled.run).not.toHaveBeenCalled();
  });
});
