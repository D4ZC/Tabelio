import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ensureObject, normalizeReview, safeFile, validateCatalog } from './import-legal-library.mjs';

const hash = (data) => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'legal-library-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'catalog');
  const source = join(dir, 'sources');
  const data = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.from('documento sintético')]);
  const text = Buffer.from('Texto\n  del documento\n');
  const revision = { id: 'doc-a', sha256_revisado: hash(data), tipo_documental: 'convenio_divorcio', materia: 'familiar',
    variante: 'base', uso_propuesto: 'plantilla_base', confianza: 'alta', observaciones: [], bloqueos_integracion: ['Revisar'], campos_relevantes: ['fecha'], subdocumentos: [] };
  const doc = { id: 'doc-a', procedencia: 'Saul', nombre_original: 'Documento.doc', tipo_etiqueta: 'Convenio de divorcio', paquete_id: 'pack-a',
    ruta_original: 'Saul/Documento.doc', ruta_organizada: 'por-tipo/Documento.doc', ruta_texto: 'analisis/textos/Documento.txt',
    sha256: hash(data), sha256_texto: hash(text), sha256_texto_espacios_normalizados: hash('Texto del documento'), bytes: data.length,
    formato: { mime: 'application/msword', extension: '.doc' }, revision, duplicado_exacto_de: null, texto_equivalente_a: null };
  const catalog = { version_esquema: 1, resumen: { archivos: 1, contenido_binario_unico: 1, paquetes_documentales: 1 }, documentos: [doc] };
  const put = async (path, value) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, value); };
  const save = async () => {
    await put(join(root, 'catalogo.json'), JSON.stringify(catalog));
    await put(join(root, 'analisis/revision-por-documento.json'), JSON.stringify({ documentos: [revision] }));
    await put(join(root, 'paquetes.json'), JSON.stringify({ paquetes: [{ id: 'pack-a', agrupacion_original: 'Saul/Documento.doc', documentos: ['doc-a'] }] }));
  };
  await put(join(source, doc.ruta_original), data);
  await put(join(root, doc.ruta_organizada), data);
  await put(join(root, doc.ruta_texto), text);
  await save();
  return { dir, root, source, catalog, doc, revision, data, save, put };
}

test('valida todas las evidencias y normaliza la materia sin perder su valor original', async (t) => {
  const f = await fixture(t);
  const result = await validateCatalog(f.root, f.source);
  assert.deepEqual(result.summary, { documents: 1, contents: 1, packages: 1, sources: 1 });
  assert.equal(result.prepared[0].legalFamily, 'divorcio');
  assert.match(result.prepared[0].review.notes[0], /familiar/);
  assert.equal(normalizeReview({ ...f.revision, materia: 'prestamo_arrendamiento_inconsistente' }).legalFamily, 'materia_por_revisar');
});

test('rechaza revisión desactualizada antes de importar', async (t) => {
  const f = await fixture(t);
  f.revision.sha256_revisado = '0'.repeat(64);
  await f.save();
  await assert.rejects(validateCatalog(f.root, f.source), { code: 'STALE_REVIEW' });
});

test('rechaza copias o textos alterados y originales no revisados', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, f.doc.ruta_organizada), 'alterado');
  await assert.rejects(validateCatalog(f.root, f.source), { code: 'BINARY_HASH_MISMATCH' });
  await writeFile(join(f.root, f.doc.ruta_organizada), f.data);
  await writeFile(join(f.root, f.doc.ruta_texto), 'alterado');
  await assert.rejects(validateCatalog(f.root, f.source), { code: 'TEXT_HASH_MISMATCH' });
  await writeFile(join(f.root, f.doc.ruta_texto), 'Texto\n  del documento\n');
  await writeFile(join(f.source, 'Saul/nuevo.doc'), f.data);
  await assert.rejects(validateCatalog(f.root, f.source), { code: 'INCOMPLETE_ORIGINALS' });
});

test('rechaza salidas de raíz, incluso mediante enlaces simbólicos', async (t) => {
  const f = await fixture(t);
  await assert.rejects(safeFile(f.root, '../sources/Saul/Documento.doc'), { code: 'UNSAFE_PATH' });
  await symlink(join(f.source, 'Saul/Documento.doc'), join(f.root, 'escape.doc'));
  await assert.rejects(safeFile(f.root, 'escape.doc'), { code: 'UNSAFE_PATH' });
});

test('no confunde coincidencias de texto con duplicados binarios', async (t) => {
  const f = await fixture(t);
  f.doc.duplicado_exacto_de = 'inexistente';
  await f.save();
  await assert.rejects(validateCatalog(f.root, f.source), { code: 'INVALID_DUPLICATE' });
});

test('dry-run no escribe, el reintento verifica EEXIST y un objeto corrupto nunca se sobrescribe', async () => {
  const data = Buffer.from('contenido de prueba');
  const item = { doc: { sha256: hash(data) }, data };
  let stored;
  let writes = 0;
  const storage = {
    open: async () => { if (!stored) throw Object.assign(new Error(), { code: 'ENOENT' }); return Readable.from(stored); },
    putBuffer: async (_key, buffer) => { writes += 1; stored = buffer; throw Object.assign(new Error(), { code: 'EEXIST' }); },
  };
  assert.equal(await ensureObject(storage, 'key', item, true), 'missing');
  assert.equal(writes, 0);
  assert.equal(await ensureObject(storage, 'key', item), 'stored');
  assert.equal(await ensureObject(storage, 'key', item), 'reused');
  assert.equal(writes, 1);
  stored = Buffer.from('corrupto');
  await assert.rejects(ensureObject(storage, 'key', item), { code: 'STORAGE_HASH_MISMATCH' });
  assert.equal(writes, 1);
});
