#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, realpath, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const HASH = /^[a-f0-9]{64}$/;
const COLLECTION = 'saul-alex';
const WORD_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const PYTHON_WHITESPACE = /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;

export class ImportError extends Error {
  constructor(code, message) { super(message); this.name = 'ImportError'; this.code = code; }
}
function assert(condition, code, message) {
  if (!condition) throw new ImportError(code, message);
}
const digest = (data) => createHash('sha256').update(data).digest('hex');
const stable = (value) => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});
const normalizedText = (text) => text.replace(PYTHON_WHITESPACE, ' ').trim();
const inside = (root, path) => { const rel = relative(root, path); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };

export async function safeFile(root, path) {
  assert(typeof path === 'string' && path && !path.includes('\\') && !isAbsolute(path), 'UNSAFE_PATH', 'El catálogo contiene una ruta no permitida.');
  const candidate = resolve(root, path);
  assert(inside(root, candidate), 'UNSAFE_PATH', 'Una ruta del catálogo sale de su raíz.');
  let actual;
  try { actual = await realpath(candidate); } catch { throw new ImportError('MISSING_FILE', 'Falta un archivo requerido por el catálogo.'); }
  assert(inside(root, actual), 'UNSAFE_PATH', 'Un enlace del catálogo sale de su raíz.');
  return actual;
}

async function readJson(root, path) {
  const data = await readFile(await safeFile(root, path));
  try { return { value: JSON.parse(data.toString('utf8')), data }; }
  catch { throw new ImportError('INVALID_JSON', 'Un manifiesto requerido no contiene JSON válido.'); }
}

async function listFiles(root, folder) {
  const start = resolve(root, folder);
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      assert(inside(root, await realpath(path)), 'UNSAFE_PATH', 'Un enlace documental sale de su raíz.');
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(relative(root, path).split(sep).join('/'));
    }
  }
  await visit(start);
  return files;
}

export function normalizeReview(review) {
  const notes = [...review.observaciones];
  const legalFamily = ({ familiar: 'divorcio', justicia_alternativa: 'administrativo', administrativo: 'administrativo',
    prestamo_arrendamiento_inconsistente: 'materia_por_revisar' })[review.materia] ?? review.materia;
  if (legalFamily !== review.materia) notes.push(`Materia original del catálogo: ${review.materia}.`);
  return { legalFamily, review: { notes, blockers: [...review.bloqueos_integracion], fields: [...review.campos_relevantes],
    subdocuments: [...review.subdocumentos], confidence: review.confianza } };
}

export async function validateCatalog(rootPath, sourceRootPath) {
  const root = await realpath(rootPath);
  const sourceRoot = await realpath(sourceRootPath);
  const { value: catalog, data: catalogBytes } = await readJson(root, 'catalogo.json');
  const { value: reviews } = await readJson(root, 'analisis/revision-por-documento.json');
  const { value: packages } = await readJson(root, 'paquetes.json');
  assert(catalog.version_esquema === 1 && Array.isArray(catalog.documentos) && catalog.documentos.length > 0,
    'INVALID_CATALOG', 'El catálogo está vacío o usa un esquema no admitido.');
  assert(Array.isArray(reviews.documentos) && Array.isArray(packages.paquetes), 'INVALID_CATALOG', 'Faltan revisiones o paquetes documentales.');
  const docs = catalog.documentos;
  for (const field of ['id', 'ruta_original', 'ruta_organizada', 'ruta_texto']) {
    assert(new Set(docs.map((doc) => doc[field])).size === docs.length, 'DUPLICATE_ID', 'Hay identificadores o rutas documentales repetidos.');
  }
  const reviewById = new Map(reviews.documentos.map((review) => [review.id, review]));
  const packageById = new Map(packages.paquetes.map((pack) => [pack.id, pack]));
  assert(reviewById.size === docs.length && reviews.documentos.length === docs.length && packageById.size === packages.paquetes.length,
    'INCOMPLETE_REVIEW', 'Las revisiones o paquetes no tienen cobertura única.');
  const packageMembers = packages.paquetes.flatMap((pack) => pack.documentos);
  assert(packageMembers.length === docs.length && new Set(packageMembers).size === docs.length,
    'INCOMPLETE_PACKAGE', 'Los paquetes no cubren cada documento una sola vez.');
  const prepared = [];
  for (const doc of docs) {
    const review = doc.revision;
    for (const key of ['id', 'procedencia', 'nombre_original', 'tipo_etiqueta', 'paquete_id']) {
      assert(typeof doc[key] === 'string' && doc[key].trim(), 'INVALID_METADATA', 'Faltan metadatos documentales obligatorios.');
    }
    assert(HASH.test(doc.sha256) && HASH.test(doc.sha256_texto) && HASH.test(doc.sha256_texto_espacios_normalizados), 'INVALID_HASH', 'El catálogo contiene un hash inválido.');
    assert(review && review.id === doc.id && review.sha256_revisado === doc.sha256 && stable(reviewById.get(doc.id)) === stable(review),
      'STALE_REVIEW', 'Una revisión no corresponde al documento o a su hash.');
    for (const key of ['tipo_documental', 'materia', 'variante', 'uso_propuesto', 'confianza']) {
      assert(typeof review[key] === 'string' && review[key].trim(), 'INCOMPLETE_REVIEW', 'Una revisión no tiene clasificación completa.');
    }
    for (const key of ['observaciones', 'bloqueos_integracion', 'campos_relevantes', 'subdocumentos']) {
      assert(Array.isArray(review[key]) && review[key].every((item) => typeof item === 'string'), 'INVALID_REVIEW', 'Una revisión tiene campos de formato inesperado.');
    }
    const pack = packageById.get(doc.paquete_id);
    assert(pack && typeof pack.agrupacion_original === 'string' && pack.documentos.includes(doc.id), 'INCOMPLETE_PACKAGE', 'Falta la relación documental con su paquete.');
    assert(doc.ruta_original.startsWith(`${doc.procedencia}/`) && doc.ruta_organizada.startsWith('por-tipo/') && doc.ruta_texto.startsWith('analisis/textos/'),
      'UNSAFE_PATH', 'Una ruta no corresponde a su clase documental.');
    const original = await readFile(await safeFile(sourceRoot, doc.ruta_original));
    const data = await readFile(await safeFile(root, doc.ruta_organizada));
    const textBytes = await readFile(await safeFile(root, doc.ruta_texto));
    assert(digest(original) === doc.sha256 && digest(data) === doc.sha256 && data.length === doc.bytes,
      'BINARY_HASH_MISMATCH', 'Un original o su copia no coincide con la revisión.');
    assert(doc.formato?.mime === 'application/msword' && doc.formato.extension === '.doc' && data.subarray(0, 8).equals(WORD_SIGNATURE),
      'UNEXPECTED_FORMAT', 'El formato de un documento no coincide con el catálogo.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes); }
    catch { throw new ImportError('INVALID_TEXT', 'Una extracción no contiene texto UTF-8 válido.'); }
    assert(text.trim() && digest(textBytes) === doc.sha256_texto && digest(normalizedText(text)) === doc.sha256_texto_espacios_normalizados,
      'TEXT_HASH_MISMATCH', 'Una extracción no coincide con sus hashes.');
    prepared.push({ doc, pack, data, text, ...normalizeReview(review) });
  }
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  for (const doc of docs) {
    for (const [field, hash] of [['duplicado_exacto_de', 'sha256'], ['texto_equivalente_a', 'sha256_texto_espacios_normalizados']]) {
      const target = doc[field];
      assert(target === null || (target !== doc.id && byId.has(target) && byId.get(target)[hash] === doc[hash]),
        'INVALID_DUPLICATE', 'Una relación de duplicado no coincide con su contenido.');
    }
  }
  const copies = (await listFiles(root, 'por-tipo')).sort();
  assert(stable(copies) === stable(docs.map((doc) => doc.ruta_organizada).sort()), 'INCOMPLETE_COPIES', 'Las copias no coinciden con la cobertura del catálogo.');
  const originals = [];
  for (const source of new Set(docs.map((doc) => doc.procedencia))) {
    await safeFile(sourceRoot, docs.find((doc) => doc.procedencia === source).ruta_original);
    const sourcePath = resolve(sourceRoot, source);
    assert(inside(sourceRoot, sourcePath), 'UNSAFE_PATH', 'La procedencia no es una carpeta permitida.');
    originals.push(...(await listFiles(sourceRoot, source)).filter((path) => !['.DS_Store', 'Thumbs.db', 'AGENTS.md'].includes(path.split('/').at(-1))));
  }
  assert(stable(originals.sort()) === stable(docs.map((doc) => doc.ruta_original).sort()), 'INCOMPLETE_ORIGINALS', 'Las fuentes contienen archivos no revisados o faltantes.');
  const unique = new Map(prepared.map((item) => [item.doc.sha256, item]));
  assert(catalog.resumen?.archivos === docs.length && catalog.resumen?.contenido_binario_unico === unique.size
    && catalog.resumen?.paquetes_documentales === packageById.size, 'INVALID_SUMMARY', 'Los conteos del catálogo no corresponden a sus documentos.');
  return { prepared, unique, checksum: digest(catalogBytes), summary: { documents: docs.length, contents: unique.size,
    packages: packageById.size, sources: new Set(docs.map((doc) => doc.procedencia)).size } };
}

export function isMissingObject(error) {
  return error?.code === 'ENOENT' || error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;
}

async function inspectObject(storage, key, expectedHash, expectedSize) {
  try {
    const stream = await storage.open(key);
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for await (const chunk of stream) {
        bytes += chunk.length;
        assert(bytes <= expectedSize, 'STORAGE_HASH_MISMATCH', 'Un objeto existente tiene contenido distinto; se conserva sin sobrescribir.');
        hash.update(chunk);
      }
    } finally { stream.destroy(); }
    assert(bytes === expectedSize && hash.digest('hex') === expectedHash, 'STORAGE_HASH_MISMATCH', 'Un objeto existente tiene contenido distinto; se conserva sin sobrescribir.');
    return true;
  } catch (error) {
    if (isMissingObject(error)) return false;
    throw error;
  }
}

export async function ensureObject(storage, key, item, dryRun = false) {
  if (await inspectObject(storage, key, item.doc.sha256, item.data.length)) return 'reused';
  if (dryRun) return 'missing';
  try { await storage.putBuffer(key, item.data, 'application/msword', `${item.doc.sha256}.doc`); }
  catch (error) { if (error?.code !== 'EEXIST') throw error; }
  assert(await inspectObject(storage, key, item.doc.sha256, item.data.length), 'STORAGE_MISSING', 'No se pudo verificar un objeto después de almacenarlo.');
  return 'stored';
}

function parseArgs(argv) {
  const options = { root: resolve(process.cwd(), 'documentos-organizados/saul-alex'), sourceRoot: process.cwd(), dryRun: false };
  const flags = { '--root': 'root', '--source-root': 'sourceRoot', '--organization': 'organization', '--actor': 'actor' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (flags[arg]) {
      assert(argv[i + 1] && !argv[i + 1].startsWith('--'), 'INVALID_ARGUMENT', 'Falta el valor de una opción.');
      options[flags[arg]] = argv[++i];
    } else throw new ImportError('INVALID_ARGUMENT', 'Opción no admitida. Consulta --help.');
  }
  return options;
}

async function runtime() {
  require('reflect-metadata');
  const { Module } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  const { ConfigModule } = require('@nestjs/config');
  let PrismaService, ObjectStorageService, validateRuntimeConfig;
  try {
    ({ PrismaService } = require('../apps/api/dist/prisma/prisma.service.js'));
    ({ ObjectStorageService } = require('../apps/api/dist/documents/object-storage.service.js'));
    ({ validateRuntimeConfig } = require('../apps/api/dist/config/runtime-config.js'));
  } catch { throw new ImportError('BUILD_REQUIRED', 'Compila la API y genera Prisma antes de importar.'); }
  class ImportRuntimeModule {}
  Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: [resolve(process.cwd(), '.env'), resolve(projectRoot, '.env')],
    expandVariables: true, validate: validateRuntimeConfig })], providers: [PrismaService, ObjectStorageService] })(ImportRuntimeModule);
  const app = await NestFactory.createApplicationContext(ImportRuntimeModule, { logger: false, abortOnError: false });
  return { app, prisma: app.get(PrismaService), storage: app.get(ObjectStorageService) };
}

async function resolveIdentity(prisma, options) {
  let organizations;
  if (options.organization) organizations = await prisma.organization.findMany({ where: { OR: [{ id: options.organization }, { slug: options.organization }] }, select: { id: true }, take: 2 });
  else organizations = await prisma.organization.findMany({ select: { id: true }, take: 2 });
  assert(organizations.length === 1, 'ORGANIZATION_REQUIRED', 'Indica --organization con un ID o slug existente; sólo se permite selección automática cuando hay una organización.');
  const organizationId = organizations[0].id;
  const admins = await prisma.membership.findMany({ where: { organizationId, role: 'ADMIN', user: { active: true,
    ...(options.actor ? { OR: [{ id: options.actor }, { email: options.actor }] } : {}) } }, select: { userId: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: options.actor ? 2 : 1 });
  assert(admins.length === 1, 'ADMIN_REQUIRED', 'Se requiere un administrador activo de la organización; --actor acepta su ID o correo.');
  return { organizationId, actorUserId: admins[0].userId };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.info('npm run library:import -- [--organization <id|slug>] [--actor <id|email>] [--root <catálogo>] [--source-root <fuentes>] [--dry-run]');
    return;
  }
  let context, identity, catalog;
  const counts = { stored: 0, reused: 0, missing: 0, created: 0, updated: 0, unchanged: 0 };
  try {
    context = await runtime();
    identity = await resolveIdentity(context.prisma, options);
    assert(context.prisma.libraryDocument, 'SCHEMA_REQUIRED', 'Genera Prisma y aplica la migración de biblioteca antes de importar.');
    catalog = await validateCatalog(options.root, options.sourceRoot);
    const existing = await context.prisma.libraryDocument.findMany({ where: { organizationId: identity.organizationId, collectionId: COLLECTION } });
    const byExternalId = new Map(existing.map((doc) => [doc.externalId, doc]));
    const objectKey = (hash) => `${encodeURIComponent(identity.organizationId)}/library/sha256/${hash}.doc`;
    for (const [hash, item] of catalog.unique) counts[await ensureObject(context.storage, objectKey(hash), item, options.dryRun)] += 1;
    const writes = [];
    for (const item of catalog.prepared) {
      const { doc, pack, text, legalFamily, review } = item;
      const values = { organizationId: identity.organizationId, collectionId: COLLECTION, externalId: doc.id,
        title: doc.nombre_original, source: doc.procedencia, originalPath: doc.ruta_original,
        documentType: doc.revision.tipo_documental, documentTypeLabel: doc.tipo_etiqueta, legalFamily,
        variant: doc.revision.variante, usage: doc.revision.uso_propuesto, packageId: doc.paquete_id,
        packageLabel: pack.agrupacion_original, sha256: doc.sha256, sizeBytes: doc.bytes,
        mimeType: 'application/msword', objectKey: objectKey(doc.sha256), bucket: context.storage.bucket,
        text, review, duplicateOf: doc.duplicado_exacto_de, textEquivalentTo: doc.texto_equivalente_a };
      const previous = byExternalId.get(doc.id);
      if (previous && Object.entries(values).every(([key, value]) => stable(previous[key]) === stable(value))) counts.unchanged += 1;
      else { counts[previous ? 'updated' : 'created'] += 1; writes.push(values); }
    }
    if (!options.dryRun) {
      await context.prisma.$transaction(async (tx) => {
        for (const values of writes) {
          const key = { organizationId: values.organizationId, collectionId: values.collectionId, externalId: values.externalId };
          await tx.libraryDocument.upsert({ where: { organizationId_collectionId_externalId: key },
            create: { ...values, importedById: identity.actorUserId }, update: { ...values, importedById: identity.actorUserId } });
        }
        await tx.auditEvent.create({ data: { organizationId: identity.organizationId, actorUserId: identity.actorUserId,
          action: 'LEGAL_LIBRARY_IMPORTED', entityType: 'LibraryCollection', entityId: COLLECTION,
          payload: { collectionId: COLLECTION, catalogChecksum: catalog.checksum, ...catalog.summary, ...counts } } });
      }, { maxWait: 10000, timeout: 60000 });
    }
    console.info(JSON.stringify({ mode: options.dryRun ? 'dry-run' : 'import', collection: COLLECTION, ...catalog.summary, ...counts }));
    return { ...catalog.summary, ...counts };
  } catch (error) {
    if (context && identity && !options.dryRun) {
      await context.prisma.auditEvent.create({ data: { organizationId: identity.organizationId, actorUserId: identity.actorUserId,
        action: 'LEGAL_LIBRARY_IMPORT_FAILED', entityType: 'LibraryCollection', entityId: COLLECTION,
        payload: { collectionId: COLLECTION, code: error instanceof ImportError ? error.code : 'RUNTIME_FAILURE',
          ...(catalog ? { catalogChecksum: catalog.checksum, ...catalog.summary } : {}), recordsCommitted: false,
          plannedRecords: { created: counts.created, updated: counts.updated, unchanged: counts.unchanged },
          objects: { stored: counts.stored, reused: counts.reused, missing: counts.missing } } } }).catch(() => undefined);
    }
    throw error;
  } finally { if (context) await context.app.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // No se imprime el error del proveedor: puede contener credenciales, rutas o nombres.
    console.error(error instanceof ImportError ? `${error.code}: ${error.message}` : 'RUNTIME_FAILURE: Falló la operación. Comprueba conexión, migraciones, compilación y almacenamiento.');
    process.exitCode = 1;
  });
}
