import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendAdditionalClauses,
  extractDocxParagraphs,
  readZipEntries,
  renderDocxTemplate,
} from './docx-template';

const templatePaths = [
  resolve(__dirname, '../../templates/lease-v1.docx'),
  resolve(__dirname, '../../templates/agreement-v1.docx'),
];

function values(templatePath: string) {
  const template = readFileSync(templatePath);
  const xml = readZipEntries(template).find((entry) => entry.name === 'word/document.xml')!.data.toString('utf8');
  const tokens = [...new Set([...xml.matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].map((match) => match[1]))];
  return Object.fromEntries(tokens.map((token) => [token, `Valor & prueba <${token}>`]));
}

describe('motor DOCX', () => {
  it.each(templatePaths)('materializa todos los campos de %s y conserva un paquete válido', (templatePath) => {
    const rendered = renderDocxTemplate(readFileSync(templatePath), values(templatePath));
    const document = readZipEntries(rendered).find((entry) => entry.name === 'word/document.xml');
    expect(document).toBeDefined();
    expect(document!.data.toString('utf8')).not.toMatch(/\[\[[A-Z0-9_]+\]\]/);
    expect(document!.data.toString('utf8')).toContain('Valor &amp; prueba &lt;');
  });

  it.each(templatePaths)('rechaza %s con datos faltantes', (templatePath) => {
    expect(() => renderDocxTemplate(readFileSync(templatePath), {})).toThrow(/Faltan valores/);
  });

  it('extrae texto por párrafos y decodifica entidades XML', () => {
    const templatePath = templatePaths[0];
    const rendered = renderDocxTemplate(readFileSync(templatePath), values(templatePath));
    const paragraphs = extractDocxParagraphs(rendered);
    expect(paragraphs.length).toBeGreaterThan(20);
    expect(paragraphs.join('\n')).toContain('Valor & prueba <LANDLORD_NAME>');
  });

  it.each(templatePaths)('inserta cláusulas adicionales antes del bloque de firmas en %s', (templatePath) => {
    const rendered = renderDocxTemplate(readFileSync(templatePath), values(templatePath));
    const extended = appendAdditionalClauses(rendered, [{
      title: 'Protección de datos & confidencialidad',
      body: 'Las partes protegen la información <reservada>.',
    }]);
    const paragraphs = extractDocxParagraphs(extended);
    const heading = paragraphs.indexOf('CLÁUSULAS ADICIONALES');
    const signature = paragraphs.findIndex((paragraph) => paragraph.includes('Leído que fue'));
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBeLessThan(signature);
    expect(paragraphs).toContain('Las partes protegen la información <reservada>.');
  });
});
