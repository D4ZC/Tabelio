#!/usr/bin/env node

// Offline verification with real Poppler/Tesseract and synthetic documents.
// Run after `npm run build -w @despacho/api`; no inference or database is used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const evidencePath = join(root, 'artifacts/local-document-reading-check.json');
const calls = { provider: 0, usageOperations: 0, conversations: 0, conversationChecks: 0, fetch: 0, uploads: 0, savedExtractions: 0 };
const report = {
  verifiedAt: new Date().toISOString(), offline: true, syntheticDocumentsOnly: true,
  success: false, checks: [], fixtures: [], calls,
};
const originalFetch = globalThis.fetch;
const embeddedLines = [
  'LECTURA LOCAL DEL DOCUMENTO DIGITAL',
  'Esta es una prueba sintetica sin datos personales.',
  'El texto permanece dentro de esta computadora.',
  'Referencia de comprobacion DEMO TEXTO 48271.',
];
const scanLines = [
  'PRUEBA LOCAL ESCANEADA',
  'DOCUMENTO SINTETICO',
  'LECTURA SIN IA EXTERNA',
  'REFERENCIA DEMO 97531',
];

function checked(name) {
  report.checks.push(name);
  console.log(`✓ ${name}`);
}

function normalized(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/gi, ' ').toUpperCase().trim();
}

function verifyResult(label, result, method, markers) {
  assert.equal(result.method, method, `${label}: unexpected reading method`);
  assert.equal(typeof result.message, 'string');
  assert.equal(typeof result.data, 'object');
  assert.ok(result.data && Object.values(result.data).every((value) => typeof value === 'string'));
  const text = normalized(result.text);
  for (const marker of markers) assert.ok(text.includes(normalized(marker)), `${label}: missing synthetic marker ${marker}`);
  report.fixtures.push({ label, method: result.method, documentKind: result.documentKind, textCharacters: result.text.length, markersVerified: markers.length });
}

function textStream(lines) {
  return Buffer.from(`BT\n/F1 20 Tf\n48 730 Td\n${lines.map((line, index) => `${index ? '0 -38 Td\n' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`).join('\n')}\nET\n`, 'ascii');
}

// Build a minimal valid PDF, including offsets for every object and xref.
// A JPEG page exercises actual PDF rasterization, not a mocked command runner.
function pdf(pages) {
  const objects = [];
  const add = (value) => { objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value, 'ascii')); return objects.length; };
  const stream = (data, dictionary = '') => Buffer.concat([
    Buffer.from(`<< /Length ${data.length}${dictionary ? ` ${dictionary}` : ''} >>\nstream\n`, 'ascii'),
    data, Buffer.from('\nendstream', 'ascii'),
  ]);
  const catalog = add('');
  const tree = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  for (const page of pages) {
    let image;
    if (page.jpeg) image = add(stream(page.jpeg, '/Type /XObject /Subtype /Image /Width 1800 /Height 1100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'));
    const commands = page.jpeg ? Buffer.from('q\n560 0 0 342 26 260 cm\n/Im1 Do\nQ\n', 'ascii') : textStream(page.lines);
    const content = add(stream(commands));
    pageIds.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >>${image ? ` /XObject << /Im1 ${image} 0 R >>` : ''} >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${tree} 0 R >>`, 'ascii');
  objects[tree - 1] = Buffer.from(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`, 'ascii');
  const chunks = [Buffer.from('%PDF-1.4\n%synthetic-fixture\n', 'ascii')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const encoded = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'ascii'), object, Buffer.from('\nendobj\n', 'ascii')]);
    chunks.push(encoded);
    length += encoded.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(chunks);
}

try {
  globalThis.fetch = async () => { calls.fetch += 1; throw new Error('Unexpected network request during offline verification'); };
  require('reflect-metadata');
  const sharp = require('sharp');
  const { ConfigService } = require('@nestjs/config');
  const { LocalDocumentReaderService } = require(join(root, 'apps/api/dist/documents/extraction/local-document-reader.service.js'));
  const { AssistantAttachmentsService, SAVE_ATTACHMENT_TOOL } = require(join(root, 'apps/api/dist/assistant/assistant-attachments.service.js'));
  const config = new ConfigService({
    LOCAL_OCR_ENABLED: 'true', LOCAL_OCR_LANGUAGE: 'spa+eng', LOCAL_OCR_TIMEOUT_MS: '90000',
    DOCUMENT_EXTRACTION_ENABLED: 'false', ASSISTANT_ENABLED: 'false', ASSISTANT_API_KEY: '',
  });
  const reader = new LocalDocumentReaderService(config);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1100"><rect width="1800" height="1100" fill="white"/><g fill="black" font-family="Arial,Helvetica,sans-serif" font-size="84" font-weight="700">${scanLines.map((line, index) => `<text x="110" y="${210 + index * 190}">${line}</text>`).join('')}</g></svg>`;
  const png = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).png().toBuffer();
  const jpeg = await sharp(png).flatten({ background: '#ffffff' }).removeAlpha().toColourspace('srgb').jpeg({ quality: 96 }).toBuffer();
  const textPdf = pdf([{ lines: embeddedLines }]);
  const scanPdf = pdf([{ jpeg }]);
  const mixedPdf = pdf([{ lines: embeddedLines }, { jpeg }]);

  const textResult = await reader.read(textPdf, 'application/pdf');
  verifyResult('PDF con texto digital', textResult, 'pdf-text', ['LECTURA LOCAL DEL DOCUMENTO DIGITAL', 'DEMO TEXTO 48271']);
  checked('PDF digital leído mediante texto de Poppler');
  const imageResult = await reader.read(png, 'image/png');
  verifyResult('PNG sintético', imageResult, 'ocr', ['PRUEBA LOCAL ESCANEADA', 'DOCUMENTO SINTETICO']);
  checked('Imagen PNG leída mediante Tesseract real');
  const scanResult = await reader.read(scanPdf, 'application/pdf');
  verifyResult('PDF escaneado', scanResult, 'ocr', ['PRUEBA LOCAL ESCANEADA', 'DOCUMENTO SINTETICO']);
  checked('PDF escaneado rasterizado y leído mediante OCR');
  const mixedResult = await reader.read(mixedPdf, 'application/pdf');
  verifyResult('PDF mixto de dos páginas', mixedResult, 'mixed', ['LECTURA LOCAL DEL DOCUMENTO DIGITAL', 'PRUEBA LOCAL ESCANEADA']);
  checked('PDF mixto conserva texto digital y OCR de páginas escaneadas');

  const user = {
    userId: 'local-check-user', membershipId: 'local-check-member', organizationId: 'local-check-org',
    email: 'offline-check@example.test', displayName: 'Offline check', organizationName: 'Synthetic', role: 'ADMIN',
  };
  const savedDocument = { id: 'local-check-document', organizationId: user.organizationId, matterId: 'local-check-matter' };
  let savedExtraction;
  const documents = {
    async upload() { calls.uploads += 1; return savedDocument; },
    async recordExtraction(_user, _document, extraction) {
      calls.savedExtractions += 1;
      savedExtraction = extraction;
      return { document: savedDocument, run: { id: 'local-check-run' } };
    },
  };
  const provider = { async createResponse() { calls.provider += 1; throw new Error('Local reading attempted to call AI'); } };
  const usage = {
    async runOperation() { calls.usageOperations += 1; throw new Error('Local reading attempted to create an AI operation'); },
    async createConversation() { calls.conversations += 1; throw new Error('Local reading attempted to create an AI conversation'); },
    async assertConversation() { calls.conversationChecks += 1; throw new Error('No conversation should be present in this fixture'); },
  };
  const attachments = new AssistantAttachmentsService(provider, documents, config, usage, reader);
  try {
    const original = { originalname: 'documento-local-sintetico.png', mimetype: 'image/png', buffer: png, size: png.length };
    const result = await attachments.stage(user, [original]);
    const preview = result.attachments[0];
    assert.equal(preview.extractionMode, 'local');
    assert.equal(preview.extractionMethod, 'ocr');
    assert.equal(preview.provider, 'local-ocr');
    assert.ok(normalized(preview.text).includes('PRUEBA LOCAL ESCANEADA'));
    assert.equal(result.conversationId, undefined);
    const context = attachments.context(user, [preview.id]);
    assert.equal(context.length, 1);
    assert.equal(Object.hasOwn(context[0], 'text'), false);
    assert.ok(!JSON.stringify(context).includes(preview.text));
    checked('Adjunto local por omisión devuelve texto a UI y lo omite del contexto del modelo');

    const session = attachments.wrapSession({ tools: [], async callTool() { throw new Error('Unexpected remote tool call'); }, async close() {} }, user);
    const saved = await session.callTool(SAVE_ATTACHMENT_TOOL, { attachmentId: preview.id, matterId: savedDocument.matterId, type: 'OTHER' });
    assert.notEqual(saved.isError, true);
    assert.equal(savedExtraction?.status, 'MANUAL_REVIEW');
    assert.equal(savedExtraction?.provider, 'local-ocr');
    assert.equal(savedExtraction?.data.extractedText, preview.text);
    assert.equal(Object.hasOwn(saved.structuredContent.data, 'extractedText'), false);
    assert.ok(!JSON.stringify(saved).includes('PRUEBA LOCAL ESCANEADA'));
    assert.ok(!JSON.stringify(saved).includes(preview.text));
    assert.equal(calls.uploads, 1);
    assert.equal(calls.savedExtractions, 1);
    assert.equal(attachments.context(user, [preview.id]).length, 0);
    checked('Guardado conserva texto en rawData para revisión y evita retornarlo al modelo');
  } finally {
    attachments.onModuleDestroy();
  }

  for (const key of ['provider', 'usageOperations', 'conversations', 'conversationChecks', 'fetch']) assert.equal(calls[key], 0, `Unexpected calls: ${key}`);
  checked('Cero inferencias, llamadas de red u operaciones de consumo de IA');
  report.success = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Offline verification failed';
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ success: report.success, checks: report.checks.length, calls, evidence: evidencePath, ...(report.error ? { error: report.error } : {}) }, null, 2));
}
