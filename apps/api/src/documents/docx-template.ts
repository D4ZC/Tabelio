import { deflateRawSync, inflateRawSync } from 'node:zlib';

interface ZipEntry {
  name: string;
  data: Buffer;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('El archivo DOCX no contiene un directorio ZIP válido');
}

export function readZipEntries(archive: Buffer): ZipEntry[] {
  const endOffset = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  let centralOffset = archive.readUInt32LE(endOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error('El directorio ZIP del DOCX está dañado');
    }
    const compression = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const uncompressedSize = archive.readUInt32LE(centralOffset + 24);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const name = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8');

    if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`La entrada ${name} no contiene un encabezado ZIP válido`);
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const data = compression === 0
      ? Buffer.from(compressed)
      : compression === 8
        ? inflateRawSync(compressed)
        : undefined;
    if (!data) throw new Error(`El DOCX usa una compresión ZIP no soportada en ${name}`);
    if (data.length !== uncompressedSize) throw new Error(`La entrada ${name} tiene un tamaño inválido`);
    entries.push({ name, data });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_entity, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_entity, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

export function extractDocxParagraphs(archive: Buffer): string[] {
  const document = readZipEntries(archive).find((entry) => entry.name === 'word/document.xml');
  if (!document) throw new Error('El archivo DOCX no contiene word/document.xml');

  return [...document.data.toString('utf8').matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)]
    .map((paragraph) => {
      const parts = [...paragraph[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/\s*>|<w:br\s*\/\s*>/g)];
      return parts.map((part) => part[1] === undefined ? ' ' : decodeXmlText(part[1])).join('').trim();
    })
    .filter(Boolean);
}

export function createZipArchive(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const isDirectory = entry.name.endsWith('/');
    const compression = isDirectory || entry.data.length === 0 ? 0 : 8;
    const compressed = compression === 8 ? deflateRawSync(entry.data) : entry.data;
    const checksum = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(compression, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x21, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(compression, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(isDirectory ? 0x10 : 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function renderDocxTemplate(template: Buffer, values: Record<string, string>): Buffer {
  const entries = readZipEntries(template);
  const document = entries.find((entry) => entry.name === 'word/document.xml');
  if (!document) throw new Error('La plantilla DOCX no contiene word/document.xml');

  const source = document.data.toString('utf8');
  const expectedTokens = [...new Set([...source.matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].map((match) => match[1]))];
  const missing = expectedTokens.filter((token) => values[token] === undefined || values[token].trim() === '');
  if (missing.length) throw new Error(`Faltan valores para la plantilla: ${missing.join(', ')}`);

  const rendered = source.replace(/\[\[([A-Z0-9_]+)\]\]/g, (_marker, token: string) => {
    return escapeXmlText(values[token]);
  });
  if (/\[\[[A-Z0-9_]+\]\]/.test(rendered)) throw new Error('La plantilla conserva marcadores sin resolver');
  document.data = Buffer.from(rendered, 'utf8');
  return createZipArchive(entries);
}

export interface AdditionalClauseContent {
  title: string;
  body: string;
}

function docxParagraph(text: string, bold = false): string {
  const runProperties = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${bold ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr>`;
  return `<w:p><w:pPr><w:pStyle w:val="Normal"/><w:spacing w:lineRule="auto" w:line="360" w:before="120" w:after="120"/><w:jc w:val="both"/></w:pPr><w:r>${runProperties}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`;
}

export function appendAdditionalClauses(
  documentBuffer: Buffer,
  clauses: AdditionalClauseContent[],
): Buffer {
  if (clauses.length === 0) return documentBuffer;
  const entries = readZipEntries(documentBuffer);
  const document = entries.find((entry) => entry.name === 'word/document.xml');
  if (!document) throw new Error('El archivo DOCX no contiene word/document.xml');

  const source = document.data.toString('utf8');
  const anchorTextOffset = source.indexOf('Leído que fue');
  let insertionOffset = anchorTextOffset < 0 ? -1 : source.lastIndexOf('<w:p', anchorTextOffset);
  while (
    insertionOffset >= 0
    && source[insertionOffset + 4] !== '>'
    && source[insertionOffset + 4] !== ' '
  ) {
    insertionOffset = source.lastIndexOf('<w:p', insertionOffset - 1);
  }
  if (insertionOffset < 0) {
    throw new Error('La plantilla no contiene el punto de inserción para cláusulas adicionales');
  }

  const clauseXml = [
    docxParagraph('CLÁUSULAS ADICIONALES', true),
    ...clauses.flatMap((clause) => [
      docxParagraph(clause.title.trim(), true),
      ...clause.body
        .split(/\r?\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => docxParagraph(paragraph)),
    ]),
  ].join('');
  document.data = Buffer.from(
    `${source.slice(0, insertionOffset)}${clauseXml}${source.slice(insertionOffset)}`,
    'utf8',
  );
  return createZipArchive(entries);
}
