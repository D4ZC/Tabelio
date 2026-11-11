#!/usr/bin/env node
/**
 * Importa el respaldo de Corporativo Clerc (registro de control + carpetas de convenios)
 * a una organización de Tabelio. Consume el manifiesto generado por scripts/clerc/analyze.py.
 *
 * Es idempotente: los expedientes se identifican por su referencia (EXP ####, CONV n/aaaa, ...),
 * las personas por nombre normalizado, los inmuebles por domicilio normalizado y los documentos
 * por expediente + SHA-256. Volver a ejecutarlo sólo agrega lo faltante y actualiza metadatos.
 *
 * npm run clerc:import -- --manifest <manifest.json> [--texts <carpeta>] [--organization clerc]
 *   [--admin-email admin@clerc.local] [--limit N] [--skip-files] [--dry-run]
 *   [--reset --yes-delete-imported-data]   (borra lo importado de la organización antes de volver a importar)
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const ORG_NAME = 'Corporativo Clerc, S.C.';
const CENTER_NAME = 'Corporativo Clerc, Sociedad Civil — Centro Privado de Métodos Alternos';
const CENTER_ACCREDITATION = '100';
const LIBRARY_COLLECTION = 'clerc-formatos';
const TODAY = new Date();
const GDL_OFFSET = '-06:00';
const FACILITATORS = {
  SAUL: 'José Saúl Ávila Gutiérrez Hermosillo',
  ALEX: 'Alejandro Jhovaney Ávila Gutiérrez Hermosillo',
  AMOR: 'Amor Isabel Reyes Fernández',
};
const MUNICIPALITIES = [
  ['TLAJOMULCO', 'Tlajomulco de Zúñiga'], ['TLAQUEPAQUE', 'San Pedro Tlaquepaque'], ['TONALA', 'Tonalá'],
  ['ZAPOPAN', 'Zapopan'], ['EL SALTO', 'El Salto'], ['PUERTO VALLARTA', 'Puerto Vallarta'], ['CHAPALA', 'Chapala'],
  ['ZAPOTLANEJO', 'Zapotlanejo'], ['IXTLAHUACAN', 'Ixtlahuacán de los Membrillos'], ['JUANACATLAN', 'Juanacatlán'],
  ['GUADALAJARA', 'Guadalajara'],
];
const MIME = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.heic': 'image/heic', '.gif': 'image/gif',
  '.zip': 'application/zip', '.xml': 'application/xml', '.mp4': 'video/mp4', '.txt': 'text/plain',
  '.url': 'text/plain', '.rtf': 'application/rtf', '.odt': 'application/vnd.oasis.opendocument.text',
};

// ------------------------------------------------------------------ utilidades
export const normKey = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const clean = (text) => (text == null ? null : String(text).replace(/\s+/g, ' ').trim() || null);
const COMPANY = /\b(SOCIEDAD|S ?A ?DE ?C ?V|S ?A ?P ?I|S ?DE ?R ?L|S ?C\b|A ?C\b|S ?A\b|BANCO|INSTITUCION|ASOCIADOS|CORPORATIVO|INMOBILIARIA|GRUPO|FIDEICOMISO|COMPANIA|CONSTRUCTORA|DESARROLLADORA|ADMINISTRADORA|LOGISTICA|ASOCIACION)\b/;
export const isCompany = (name) => COMPANY.test(normKey(name));
const ALIASES = new Map([['CAVIACE', 'CAVIACE Y ASOCIADOS SOCIEDAD CIVIL'], ['CAVIACE Y ASOCIADOS', 'CAVIACE Y ASOCIADOS SOCIEDAD CIVIL']]);

const trimName = (text) => clean(String(text ?? '').replace(/^[\s,.;:"“”'-]+|[\s,.;:"“”'-]+$/g, ''));

/** Separa "Fulano y Mengana" en personas; las razones sociales no se dividen. */
export function splitNames(raw) {
  const text = trimName(raw);
  if (!text) return [];
  const groups = text.split(/,?\s+(?:as[ií] como|adem[aá]s)\s+/i);
  if (groups.length > 1) return groups.flatMap(splitNames);
  if (isCompany(text)) return [text];
  const parts = text.split(/\s+y\s+|\s*;\s*/i);
  // Listas "Nombre Apellido, Nombre Apellido" de personas físicas.
  const expanded = parts.flatMap((part) => {
    const pieces = part.split(',').map(trimName).filter(Boolean);
    return pieces.length > 1 && pieces.every((piece) => piece.split(' ').length >= 2) ? pieces : [part];
  });
  return expanded.map(trimName).filter((name) => name && name.length > 3 && /[a-záéíóúñ]{3}/i.test(name));
}

const TITLE = /\b(?:se[ñn]or(?:a|es|as)?|sr(?:a|es)?\.?|licenciad[oa]s?|lic\.|ingenier[oa]s?|ing\.|doctor(?:a|es)?|dr(?:a)?\.|c\.\s?p\.|contador(?:a|es)?(?: p[uú]blic[oa]s?)?|arquitect[oa]s?|arq\.)\s+/gi;
const ROLE_PREFIX = /^\s*(?:de\s+)?(?:su|sus)\s+(?:[a-záéíóúñ]+\s+){0,3}?(?:apoderad[oa]s?|representantes?|administrador(?:a|es)?|gerente|presidente|director(?:a)?)(?:\s+(?:general(?:es)?|legal(?:es)?|[uú]nic[oa]|especial|mancomunad[oa]s?))*\s*,?\s*(?:con facultades suficientes,?\s*)?(?:el|la|los|las)?\s*/i;
/** Quita el título ("señor", "Licenciado", ...) y conserva el nombre que le sigue. */
function afterLastTitle(text) {
  let last = -1;
  let length = 0;
  for (const match of text.matchAll(TITLE)) { last = match.index; length = match[0].length; }
  const stripped = text.replace(ROLE_PREFIX, '');
  const tail = last >= 0 ? text.slice(last + length) : stripped !== text ? stripped : text.split(',').at(-1);
  return trimName(tail.replace(/\b(?:su|sus)\s+(?:herman[oa]s?|espos[oa]|hij[oa]s?|madre|padre|c[oó]nyuge)\b/gi, ''));
}

/**
 * Separa titulares y representantes de un campo de partes del registro, p. ej.
 * "Caviace y Asociados, S.C., por conducto de su apoderado general, ... Licenciado Arturo Trejo"
 * "Sonia González, como apoderada general de la señora María Ramírez".
 */
export function parseParties(raw) {
  const text = trimName(String(raw ?? '').replace(/,?\s*por su propio derecho,?/gi, ','));
  if (!text) return { principals: [], representatives: [] };
  // Varias partes en un mismo campo: "X, así como Y, por conducto de ..., además Z ...".
  const segments = text.split(/,?\s+(?:as[ií] como|adem[aá]s)\s+/i);
  if (segments.length > 1) {
    const parsed = segments.map(parseParties);
    return { principals: parsed.flatMap((p) => p.principals), representatives: parsed.flatMap((p) => p.representatives) };
  }
  // Representante primero: "X, como apoderada general de la señora Y" / "X apoderada de los señores Y y Z".
  const repFirst = text.match(/^(.{4,}?),?\s+(?:en su car[aá]cter de\s+|como\s+)?apoderad[oa]s?(?:\s+(?:general|legal|especial))*\s+de(?:l)?\s+(?:la|las|los)?\s*(.+)$/i);
  if (repFirst && !/conducto|trav[eé]s|representad/i.test(repFirst[1])) {
    return { principals: splitNames(repFirst[2].replace(TITLE, '')), representatives: splitNames(repFirst[1]) };
  }
  // "X por su propio derecho, y en representación de su hermano Y".
  const own = text.match(/^(.+?),?\s+por su propio derecho,?\s*(?:y\s+)?(?:en representaci[oó]n de\s+(.+))?$/i);
  if (own) return { principals: [...splitNames(own[1]), ...(own[2] ? splitNames(afterLastTitle(own[2])) : [])], representatives: [] };
  // Titular primero: "X, por conducto de / a través de / representada por ... Y".
  const principalFirst = text.match(/^(.+?)[,\s]+(?:quien(?:es)? (?:comparece|act[uú]a)n?\s+)?(?:por conducto|por medio|a trav[eé]s|representad[oa]s?(?:\s+en este acto)?\s+por|en representaci[oó]n)(.*)$/i);
  if (principalFirst) {
    const representative = afterLastTitle(principalFirst[2]);
    return { principals: splitNames(principalFirst[1]), representatives: representative && representative.length > 5 ? splitNames(representative) : [] };
  }
  return { principals: splitNames(text), representatives: [] };
}

function titleCase(name) {
  if (/[a-záéíóúñ]/.test(name)) return name; // ya tiene minúsculas: se respeta la captura original
  const small = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return name.toLowerCase().replace(/\S+/g, (word, offset) => (offset > 0 && small.has(word) ? word
    : word.charAt(0).toUpperCase() + word.slice(1)));
}

function dateAt(day, hour) {
  if (!day) return null;
  const value = new Date(`${day}T${hour ?? '12:00'}:00${GDL_OFFSET}`);
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * Fechas del registro con validación: hay capturas con el año equivocado (p. ej. convenio 1019/2025
 * fechado en 2012). Si el año no coincide con el del convenio (±1), se usa la fecha de solicitud.
 */
/** Año del número de convenio sólo si es razonable (hay capturas como "47/2502"). */
export function agreementYear(agreement) {
  const year = Number(String(agreement ?? '').split('/')[1]) || null;
  return year && year >= 2010 && year <= TODAY.getFullYear() + 1 ? year : null;
}

export function matterDates(row, agreement) {
  const year = agreementYear(agreement);
  const plausible = (day) => day && (!year || Math.abs(Number(day.slice(0, 4)) - year) <= 1);
  const requestedAt = plausible(row.requestDate) ? dateAt(row.requestDate) : null;
  const agreementDay = plausible(row.agreementDate) ? row.agreementDate : (requestedAt ? row.requestDate : null);
  const signedAt = agreementDay ? dateAt(agreementDay, row.hour) : null;
  return { requestedAt: requestedAt ?? (row.requestDate ? null : signedAt), signedAt,
    corrected: Boolean(row.agreementDate && row.agreementDate !== agreementDay) };
}

function municipality(address) {
  const key = normKey(address);
  return MUNICIPALITIES.find(([needle]) => key.includes(needle))?.[1] ?? null;
}

const money = (value) => {
  const number = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(number) && number > 0 ? number.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : clean(value);
};

// ------------------------------------------------- expedientes lógicos
export function buildMatters(manifest) {
  const byRef = new Map();
  const ensure = (ref) => {
    if (!byRef.has(ref)) byRef.set(ref, { reference: ref, rows: [], folders: [] });
    return byRef.get(ref);
  };
  const refByAgreement = new Map();
  for (const row of manifest.register) {
    const ref = row.exp ? `EXP ${row.exp}` : `CONV ${row.agreement}`;
    ensure(ref).rows.push(row);
    if (row.agreement && !refByAgreement.has(row.agreement)) refByAgreement.set(row.agreement, ref);
  }
  for (const folder of manifest.folders) {
    const parsed = folder.parsed ?? {};
    let ref;
    if (folder.kind === 'TRANSACTION') ref = `TRANS ${folder.year ?? ''} ${folder.name ?? 'sueltos'}`.replace(/\s+/g, ' ').trim();
    else if (parsed.exp) ref = `EXP ${parsed.exp}`;
    else if (parsed.agreement) ref = refByAgreement.get(parsed.agreement) ?? `CONV ${parsed.agreement}`;
    else ref = `CLERC ${folder.year ?? ''} ${folder.name ?? 'sueltos'}`.replace(/\s+/g, ' ').trim();
    ensure(ref.slice(0, 120)).folders.push(folder);
  }
  for (const matter of byRef.values()) {
    // Fila principal: la que tiene convenio, de la hoja más reciente.
    matter.rows.sort((a, b) => Number(Boolean(b.agreement)) - Number(Boolean(a.agreement)) || b.sheet.localeCompare(a.sheet));
    matter.row = matter.rows[0] ?? null;
  }
  return [...byRef.values()];
}

export function matterStatus(matter) {
  const row = matter.row ?? {};
  const folderState = matter.folders.find((folder) => folder.state)?.state;
  const process = normKey(row.process);
  if (process.includes('CANCEL') || folderState === 'CANCELLED') return 'CANCELLED';
  // Números reasignados o duplicados: el trámite continuó con otro expediente/convenio.
  if (/SE PASA|PASA 20|CAMBIA|NUEVO NUMERO|NUEVO EXP|ACTUALIZA NUMERO|DUPLICADO|NO SE DIO SEGUIMIENTO/.test(process)) return 'CANCELLED';
  if (folderState === 'CONCLUDED') return 'CLOSED';
  if (/PENDIENTE (DE )?FIRMA|FALTA (1 )?FIRMA|PENDIENTE DE FECHA/.test(process)) return 'SIGNATURE';
  if (/EN PROCESO|ELABORA|POR ELABORAR|INVITACION|^PROCESO$/.test(process)) return 'DRAFTING';
  const agreement = row.agreement ?? matter.folders.find((folder) => folder.parsed?.agreement)?.parsed.agreement;
  if (!agreement) return 'INTEGRATION';
  const expiry = row.expiry ? new Date(`${row.expiry}T23:59:59${GDL_OFFSET}`) : null;
  if (expiry) return expiry >= TODAY ? 'ACTIVE' : 'CLOSED';
  const signed = matterDates(row, agreement).signedAt;
  if (!signed) return matter.folders.some((folder) => (folder.year ?? 0) >= TODAY.getFullYear()) ? 'ACTIVE' : 'CLOSED';
  return TODAY - signed < 365 * 24 * 3600 * 1000 ? 'ACTIVE' : 'CLOSED';
}

function matterNotes(matter, caviace) {
  const row = matter.row;
  const lines = ['Importado del respaldo de Corporativo Clerc.'];
  if (row) {
    lines.push(`Registro de control: hoja ${row.sheet}, fila ${row.row}.`);
    const fields = [
      ['Solicitó', row.requestedBy], ['Elaboró', row.draftedBy], ['Firma', row.signedBy],
      ['Proceso', row.process], ['Materia', row.matter], ['Acto jurídico', row.legalAct],
      ['Expediente IJA', row.ijaCaseFile], ['Sanción', row.sanction], ['Fecha de sanción', row.sanctionDate],
      ['Llegada de sanción', row.sanctionArrivalDate], ['Cobro', money(row.fee)], ['Vencimiento del arrendamiento', row.expiry],
      ['Póliza', row.policy], ['Comentario', row.comment],
    ];
    for (const [label, value] of fields) if (clean(value)) lines.push(`${label}: ${clean(value)}`);
    const dates = matterDates(row, row.agreement);
    if (dates.corrected) lines.push(`Fecha de convenio capturada en el registro: ${row.agreementDateRaw} (${row.agreementDate}); se descartó por no coincidir con el año del convenio.`);
    if (matter.rows.length > 1) lines.push(`Registros adicionales: ${matter.rows.slice(1).map((r) => `hoja ${r.sheet} fila ${r.row}`).join('; ')}.`);
  } else {
    lines.push('Sin fila en el registro de control; datos tomados de la carpeta.');
  }
  if (caviace) {
    lines.push(`Registro Caviace: IJA ${clean(caviace.ijaCaseFile) ?? '—'}, sanción ${clean(caviace.sanction) ?? '—'}, clave ${clean(caviace.cadastral) ?? '—'}.`);
  }
  for (const folder of matter.folders) lines.push(`Carpeta original: ${folder.path}`);
  if (matter.folders.length === 0) lines.push('Sin carpeta digital en el respaldo recuperado.');
  return lines.join('\n');
}

function matterTitle(matter) {
  const row = matter.row ?? {};
  const act = clean(row.legalAct);
  const actLabel = act ? titleCase(act.length < 9 && /^arrend/i.test(act) ? 'Arrendamiento' : act) : null;
  const folder = matter.folders[0];
  const parties = [row.requesting, row.complementary]
    .map((value) => parseParties(value).principals.map(titleCase).join(' y '))
    .filter(Boolean);
  const who = parties.length ? parties.join(' / ') :titleCase(clean(folder?.parsed?.label) ?? clean(folder?.name) ?? matter.reference);
  const prefix = folder?.kind === 'TRANSACTION' ? 'Transacción' : (actLabel ?? 'Convenio');
  return `${prefix} — ${who}`.slice(0, 200);
}

// ------------------------------------------------------- documentos
export function classifyFile(rel) {
  const name = normKey(rel.split('/').at(-1));
  const ext = extname(rel).toLowerCase();
  if (/\bCONVENIO\b/.test(name) && !/FORMATO|CARATULA/.test(name)) return ext === '.pdf' ? 'AGREEMENT_PDF' : 'OTHER';
  if (/\bCONTRATO\b/.test(name) && /ARREND|\bADM\b|CONTRATO$|NUEVO CONTRATO/.test(name)) return 'LEASE';
  if (/PREDIAL|ESCRITURA|TITULO DE PROPIEDAD/.test(name)) return 'PROPERTY_TITLE';
  if (/\b(INE|IFE|PASAPORTE|IDENTIFICACION|CREDENCIAL)\b/.test(name)) return 'ID';
  if (/\bCSF\b|CONSTANCIA DE SITUACION|\bRFC\b/.test(name)) return 'TAX';
  return 'OTHER';
}

function matchParty(rel, parties) {
  const tokens = new Set(normKey(rel.split('/').at(-1)).split(' '));
  const hits = parties.filter((party) => {
    const given = normKey(party.legalName).split(' ')[0];
    return given && given.length > 2 && tokens.has(given);
  });
  return hits.length === 1 ? hits[0] : null;
}

// ------------------------------------------------------- runtime
function parseArgs(argv) {
  const options = { organization: 'clerc', adminEmail: 'admin@clerc.local', dryRun: false, skipFiles: false, limit: 0 };
  const flags = { '--manifest': 'manifest', '--texts': 'texts', '--organization': 'organization', '--admin-email': 'adminEmail', '--limit': 'limit' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--reset') options.reset = true;
    else if (arg === '--yes-delete-imported-data') options.resetConfirmed = true;
    else if (arg === '--skip-files') options.skipFiles = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (flags[arg] && argv[i + 1]) options[flags[arg]] = argv[++i];
    else throw new Error(`Opción no admitida: ${arg}`);
  }
  options.limit = Number(options.limit) || 0;
  return options;
}

async function runtime() {
  require('reflect-metadata');
  const { Module } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  const { ConfigModule } = require('@nestjs/config');
  let PrismaService, ObjectStorageService, validateRuntimeConfig, domain;
  try {
    ({ PrismaService } = require('../apps/api/dist/prisma/prisma.service.js'));
    ({ ObjectStorageService } = require('../apps/api/dist/documents/object-storage.service.js'));
    ({ validateRuntimeConfig } = require('../apps/api/dist/config/runtime-config.js'));
    domain = require('../packages/domain/dist/index.js');
  } catch { throw new Error('BUILD_REQUIRED: ejecuta npm run build antes de importar.'); }
  class ImportRuntimeModule {}
  Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: [resolve(process.cwd(), '.env'), resolve(projectRoot, '.env')],
    expandVariables: true, validate: validateRuntimeConfig })], providers: [PrismaService, ObjectStorageService] })(ImportRuntimeModule);
  const app = await NestFactory.createApplicationContext(ImportRuntimeModule, { logger: false, abortOnError: false });
  return { app, prisma: app.get(PrismaService), storage: app.get(ObjectStorageService), domain };
}

async function ensureOrganization(prisma, domain, options) {
  const { hash } = require('bcryptjs');
  const organization = await prisma.organization.upsert({
    where: { slug: options.organization }, update: {}, create: { name: ORG_NAME, slug: options.organization },
  });
  let password = null;
  let user = await prisma.user.findUnique({ where: { email: options.adminEmail } });
  if (!user) {
    password = `Clerc-${randomBytes(6).toString('base64url')}!`;
    user = await prisma.user.create({ data: { email: options.adminEmail, displayName: 'Administración Clerc', passwordHash: await hash(password, 12) } });
  }
  const membership = await prisma.membership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    update: { role: 'ADMIN' }, create: { organizationId: organization.id, userId: user.id, role: 'ADMIN' },
  });
  for (const kind of ['LEASE', 'MEDIATION_AGREEMENT']) {
    const definitions = domain.checklistFor(kind);
    for (const [index, item] of definitions.entries()) {
      await prisma.requirementDefinition.upsert({
        where: { organizationId_matterKind_code: { organizationId: organization.id, matterKind: kind, code: item.code } },
        update: {},
        create: { organizationId: organization.id, matterKind: kind, code: item.code, label: item.label, blocking: item.blocking,
          appliesToRole: item.appliesToRole ?? null, completionMode: 'AUTO', sortOrder: (index + 1) * 10 },
      });
    }
  }
  return { organization, user, membership, password };
}

class Directory {
  constructor(prisma, organizationId) {
    this.prisma = prisma; this.organizationId = organizationId;
    this.people = new Map(); this.properties = new Map(); this.created = { people: 0, properties: 0 };
  }

  async load() {
    for (const person of await this.prisma.person.findMany({ where: { organizationId: this.organizationId }, select: { id: true, legalName: true } })) {
      this.people.set(normKey(person.legalName), person);
    }
    for (const property of await this.prisma.property.findMany({ where: { organizationId: this.organizationId }, select: { id: true, addressLine1: true } })) {
      this.properties.set(normKey(property.addressLine1), property);
    }
  }

  async person(rawName) {
    let key = normKey(rawName);
    key = ALIASES.get(key) ?? key;
    if (!key) return null;
    const known = this.people.get(key);
    if (known) return known;
    const legalName = key === 'CAVIACE Y ASOCIADOS SOCIEDAD CIVIL' ? 'Caviace y Asociados, Sociedad Civil' : titleCase(clean(rawName));
    const company = isCompany(legalName);
    const parts = legalName.split(' ');
    const person = await this.prisma.person.create({ data: {
      organizationId: this.organizationId, type: company ? 'COMPANY' : 'INDIVIDUAL', legalName,
      givenName: company ? null : parts.slice(0, Math.max(1, parts.length - 2)).join(' '),
      familyName: company || parts.length < 3 ? null : parts.slice(-2).join(' '),
      notes: 'Importado del registro de control de Corporativo Clerc.',
    }, select: { id: true, legalName: true } });
    this.people.set(key, person);
    this.created.people += 1;
    return person;
  }

  async property(rawAddress, cadastral) {
    const address = clean(rawAddress);
    if (!address || address.length < 6) return null;
    const key = normKey(address);
    const known = this.properties.get(key);
    if (known) {
      if (cadastral) await this.prisma.property.update({ where: { id: known.id }, data: { cadastralReference: clean(cadastral) } });
      return known;
    }
    const postal = address.match(/(?:C[OÓ]DIGO POSTAL|C\.?\s?P\.?)\s*(\d{5})/i)?.[1] ?? null;
    const property = await this.prisma.property.create({ data: {
      organizationId: this.organizationId, displayName: address.split(',')[0].slice(0, 90), addressLine1: address,
      city: municipality(address) ?? 'Por confirmar', state: 'Jalisco', postalCode: postal,
      cadastralReference: clean(cadastral), useType: 'Por confirmar',
      notes: 'Domicilio tomado del registro de control de Corporativo Clerc.',
    }, select: { id: true, addressLine1: true } });
    this.properties.set(key, property);
    this.created.properties += 1;
    return property;
  }
}

async function importMatter(ctx, matter) {
  const { prisma, organizationId, user, membership, domain, directory, caviaceByAgreement } = ctx;
  const row = matter.row ?? {};
  const status = matterStatus(matter);
  const agreement = row.agreement ?? matter.folders.find((folder) => folder.parsed?.agreement)?.parsed.agreement ?? null;
  const caviace = agreement ? caviaceByAgreement.get(agreement) : null;
  const property = await directory.property(row.property ?? caviace?.address, caviace?.cadastral);
  const { requestedAt, signedAt } = matterDates(row, agreement);
  const latest = (dates) => dates.filter((date) => date && date <= TODAY).sort((a, b) => b - a)[0];
  // Prioridad: fechas del registro; si no hay, fecha de los archivos (puede alterarla la recuperación); si no, el año.
  const lastActivity = latest([signedAt, requestedAt])
    ?? latest(matter.folders.flatMap((folder) => folder.files.map((rel) => ctx.fileByRel.get(rel)?.mtime).filter(Boolean).map((s) => new Date(s * 1000))))
    // Sin fechas: se ubica al inicio del año del convenio/hoja para no aparecer como actividad reciente.
    ?? dateAt(`${agreementYear(agreement) ?? row.sheet ?? matter.folders[0]?.year ?? ''}-01-01`);
  const data = {
    title: matterTitle(matter), kind: 'MEDIATION_AGREEMENT', status, propertyId: property?.id ?? null,
    notes: matterNotes(matter, caviace), responsibleMembershipId: membership.id,
    activatedAt: ['ACTIVE', 'CLOSED'].includes(status) ? signedAt : null,
    cancelledAt: status === 'CANCELLED' ? (signedAt ?? requestedAt ?? TODAY) : null,
    cancellationReason: status === 'CANCELLED'
      ? `Cancelado según el registro/carpeta de Corporativo Clerc${clean(row.process) ? `: ${clean(row.process)}` : ''}.`.slice(0, 500) : null,
    cancelledById: status === 'CANCELLED' ? user.id : null,
    ...(lastActivity ? { updatedAt: lastActivity } : {}),
  };
  const existing = await prisma.matter.findUnique({ where: { organizationId_reference: { organizationId, reference: matter.reference } }, select: { id: true } });
  const record = existing
    ? await prisma.matter.update({ where: { id: existing.id }, data })
    : await prisma.matter.create({ data: { ...data, organizationId, reference: matter.reference, createdById: user.id,
      ...((requestedAt ?? lastActivity) ? { createdAt: requestedAt ?? lastActivity } : {}) } });

  // Partes (se reconstruyen en cada corrida).
  const parties = [];
  const addParty = async (name, role, isPrimary) => {
    const person = await directory.person(name);
    if (person && !parties.some((p) => p.personId === person.id && p.role === role)) {
      parties.push({ personId: person.id, role, legalName: person.legalName, isPrimary });
    }
  };
  for (const [field, role] of [['requesting', 'REQUESTING_PARTY'], ['complementary', 'COMPLEMENTARY_PARTY'], ['complementaryB', 'COMPLEMENTARY_PARTY']]) {
    const { principals, representatives } = parseParties(row[field]);
    for (const name of principals) await addParty(name, role, field !== 'complementaryB');
    for (const name of representatives) await addParty(name, 'REPRESENTATIVE', false);
  }
  if (!parties.length && caviace?.tenants) {
    const owner = await directory.person('CAVIACE');
    parties.push({ personId: owner.id, role: 'REQUESTING_PARTY', legalName: owner.legalName, isPrimary: true });
    for (const name of splitNames(caviace.tenants)) {
      const person = await directory.person(name);
      parties.push({ personId: person.id, role: 'COMPLEMENTARY_PARTY', legalName: person.legalName, isPrimary: true });
    }
  }
  const facilitatorKey = normKey(row.signedBy).split(' ')[0];
  const facilitatorName = FACILITATORS[facilitatorKey] ?? clean(row.signedBy);
  await prisma.$transaction(async (tx) => {
    await tx.matterParty.deleteMany({ where: { matterId: record.id } });
    if (parties.length) {
      await tx.matterParty.createMany({ data: parties.map(({ personId, role, isPrimary }) => ({ organizationId, matterId: record.id, personId, role, isPrimary })), skipDuplicates: true });
    }
    const terms = {
      agreementNumber: agreement, caseFileNumber: row.exp ?? matter.folders[0]?.parsed?.exp ?? null,
      hearingAt: signedAt, centerName: CENTER_NAME, centerAccreditationNumber: CENTER_ACCREDITATION,
      facilitatorName, facilitatorCertification: null,
    };
    await tx.mediationTerms.upsert({ where: { matterId: record.id }, update: terms, create: { ...terms, organizationId, matterId: record.id } });
  });

  // Documentos
  const fileStats = { stored: 0, reused: 0, skipped: 0 };
  if (!ctx.options.skipFiles) {
    const already = new Set((await prisma.document.findMany({ where: { matterId: record.id }, select: { checksum: true } })).map((d) => d.checksum));
    const used = new Set();
    const files = matter.folders.flatMap((folder) => folder.files.map((rel) => ctx.fileByRel.get(rel))).filter(Boolean);
    // Preferencias: PDF antes que Word para el convenio/contrato, más reciente primero.
    files.sort((a, b) => (a.ext === '.pdf' ? 0 : 1) - (b.ext === '.pdf' ? 0 : 1) || b.mtime - a.mtime);
    for (const file of files) {
      if (already.has(file.sha256)) { fileStats.reused += 1; continue; }
      if (used.has(file.sha256)) { fileStats.skipped += 1; continue; }
      used.add(file.sha256);
      const kind = classifyFile(file.rel);
      let type = 'OTHER';
      let personId = null;
      let propertyId = null;
      if (kind === 'AGREEMENT_PDF' && ['ACTIVE', 'CLOSED'].includes(status) && !used.has('type:SIGNED_CONTRACT')) type = 'SIGNED_CONTRACT';
      else if (kind === 'LEASE' && !used.has('type:LEASE_ANNEX')) type = 'LEASE_ANNEX';
      else if (kind === 'PROPERTY_TITLE' && property && !used.has('type:PROPERTY_TITLE')) { type = 'PROPERTY_TITLE'; propertyId = property.id; }
      if (kind === 'ID' || kind === 'TAX') personId = matchParty(file.rel, parties)?.personId ?? null;
      used.add(`type:${type}`);
      await storeDocument(ctx, file, { matterId: record.id, scope: matter.reference, type, personId, propertyId,
        originalName: file.rel.split('/').at(-1), createdAt: requestedAt });
      fileStats.stored += 1;
    }
  }
  await syncChecklist(ctx, record.id, status);
  return { status, created: !existing, ...fileStats };
}

async function storeDocument(ctx, file, { matterId, scope, type, personId, propertyId, originalName, createdAt }) {
  const { prisma, storage, organizationId, user, options } = ctx;
  const ext = (file.ext || '').replace(/[^a-z0-9.]/g, '').slice(0, 10);
  // Llave estable (referencia del expediente o carpeta del cliente + SHA-256): una reimportación reutiliza el objeto.
  const safeScope = normKey(scope).toLowerCase().replace(/ /g, '-').slice(0, 80) || 'sin-expediente';
  const key = `${organizationId}/clerc/${safeScope}/${file.sha256}${ext}`;
  if (!options.dryRun) {
    const source = file.root === 'copy' ? join(ctx.sources.copy, file.rel_original ?? file.rel) : join(ctx.sources.main, file.rel);
    const buffer = await readFile(source);
    try { await storage.putBuffer(key, buffer, MIME[file.ext] ?? 'application/octet-stream', originalName); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  await prisma.document.create({ data: {
    organizationId, matterId, personId, propertyId, type, originalName, objectKey: key, bucket: storage.bucket,
    mimeType: MIME[file.ext] ?? 'application/octet-stream', sizeBytes: file.size, checksum: file.sha256,
    version: 1, uploadedById: user.id, ...(createdAt ? { createdAt } : {}),
  } });
}

async function syncChecklist(ctx, matterId, status) {
  const { prisma, organizationId, domain, definitions } = ctx;
  const matter = await prisma.matter.findUnique({ where: { id: matterId }, include: {
    parties: { select: { role: true } }, mediationTerms: true, checklistItems: true,
    documents: { select: { id: true, type: true, version: true, personId: true, propertyId: true, matterId: true, invalidatedAt: true, createdAt: true, expiresAt: true } },
  } });
  if (!matter.checklistItems.length) {
    await prisma.checklistItem.createMany({ data: definitions.map((item) => ({ ...item, organizationId, matterId })) });
    matter.checklistItems = await prisma.checklistItem.findMany({ where: { matterId } });
  }
  const m = matter.mediationTerms;
  const snapshot = {
    hasProperty: Boolean(matter.propertyId), partyRoles: matter.parties.map(({ role }) => role),
    hasLeaseTerms: false, hasLinkedLease: Boolean(matter.linkedMatterId),
    hasMediationData: Boolean(m?.agreementNumber && m.caseFileNumber && m.hearingAt && m.facilitatorName),
    documentTypes: domain.currentDocuments(matter.documents).map(({ type }) => type), hasGuaranteeProperty: Boolean(matter.guaranteePropertyId),
  };
  const historic = ['ACTIVE', 'CLOSED', 'CANCELLED'].includes(status);
  for (const item of matter.checklistItems) {
    const complete = domain.isChecklistItemComplete(item.code, snapshot);
    const next = complete ? { status: 'COMPLETE', completedAt: item.completedAt ?? matter.activatedAt ?? new Date(), waivedReason: null }
      : historic ? { status: 'WAIVED', completedAt: null, waivedReason: 'Expediente histórico importado de Corporativo Clerc: el requisito no se capturó en el sistema de origen.' }
        : { status: 'PENDING', completedAt: null, waivedReason: null };
    if (item.status !== next.status || item.waivedReason !== next.waivedReason) {
      await prisma.checklistItem.update({ where: { id: item.id }, data: next });
    }
  }
}

async function importClientDocuments(ctx, manifest) {
  // DOCUMENTOS CLIENTES/<cliente>/...: se asocian a la persona correspondiente en el directorio.
  const owners = { 'CAVIACE Y ASOCIADOS': 'CAVIACE', 'POTERES BANORTE': 'Banco Mercantil del Norte, Sociedad Anónima, Institución de Banca Múltiple, Grupo Financiero Banorte',
    'PODERES BANORTE': 'Banco Mercantil del Norte, Sociedad Anónima, Institución de Banca Múltiple, Grupo Financiero Banorte',
    'CEDULA RAQUEL GONZALEZ BECKMANN': 'Raquel González Beckmann' };
  let stored = 0;
  for (const file of manifest.files) {
    if (file.excluded || !file.sha256 || !file.rel.startsWith('DOCUMENTOS CLIENTES/')) continue;
    const folder = normKey(file.rel.split('/')[1]);
    const person = await ctx.directory.person(owners[folder] ?? file.rel.split('/')[1]);
    const exists = await ctx.prisma.document.findFirst({ where: { organizationId: ctx.organizationId, personId: person.id, checksum: file.sha256, matterId: null } });
    if (exists) continue;
    await storeDocument(ctx, file, { matterId: null, scope: `clientes ${file.rel.split('/')[1]}`, type: 'OTHER', personId: person.id, propertyId: null, originalName: file.rel.split('/').at(-1) });
    stored += 1;
  }
  return stored;
}

async function importLibrary(ctx, manifest) {
  const { prisma, storage, organizationId, user, options } = ctx;
  let created = 0;
  let updated = 0;
  for (const file of manifest.files) {
    if (file.excluded || !file.sha256 || !file.rel.startsWith('FORMATOS CONVENIOS/')) continue;
    const parts = file.rel.split('/');
    const packageLabel = parts.length > 2 ? parts[1] : 'Formatos';
    const name = parts.at(-1);
    const key = normKey(file.rel);
    const family = /LABORAL/.test(key) ? 'laboral' : /COMPRAVENTA|PROMESA/.test(key) ? 'promesa_compraventa'
      : /ADEUDO|PAGARE|PRESTAMO|MUTUO/.test(key) ? 'reconocimiento_adeudo' : /ARREND|RENTA|DESOCUPA|TERMINACION/.test(key) ? 'arrendamiento' : 'mediacion';
    let text = '';
    if (options.texts) text = await readFile(join(options.texts, `${file.sha256}.txt`), 'utf8').catch(() => '');
    const objectKey = `${organizationId}/library/${LIBRARY_COLLECTION}/${file.sha256}${file.ext}`;
    if (!options.dryRun) {
      try { await storage.putBuffer(objectKey, await readFile(join(ctx.sources.main, file.rel)), MIME[file.ext] ?? 'application/octet-stream', name); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
    }
    const values = {
      organizationId, collectionId: LIBRARY_COLLECTION, externalId: file.rel, title: name.replace(/\.[^.]+$/, ''),
      source: 'CLERC', originalPath: file.rel, documentType: 'formato_convenio', documentTypeLabel: 'Formato de convenio',
      legalFamily: family, variant: normKey(packageLabel).toLowerCase().replace(/ /g, '_') || 'formatos', usage: 'plantilla_base',
      packageId: normKey(packageLabel).toLowerCase().replace(/ /g, '-') || 'formatos', packageLabel, sha256: file.sha256, sizeBytes: file.size,
      mimeType: MIME[file.ext] ?? 'application/octet-stream', objectKey, bucket: storage.bucket,
      text: text.trim() || '(Sin texto extraído; descarga el archivo original.)',
      review: { notes: ['Formato importado del respaldo de Corporativo Clerc.'], blockers: [], fields: [], subdocuments: [], confidence: 'media' },
      duplicateOf: null, textEquivalentTo: null, importedById: user.id,
    };
    const where = { organizationId_collectionId_externalId: { organizationId, collectionId: LIBRARY_COLLECTION, externalId: file.rel } };
    const previous = await prisma.libraryDocument.findUnique({ where, select: { id: true } });
    await prisma.libraryDocument.upsert({ where, create: values, update: values });
    if (previous) updated += 1; else created += 1;
  }
  return { created, updated };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.manifest) {
    console.info('npm run clerc:import -- --manifest <manifest.json> [--texts <carpeta>] [--organization clerc] [--admin-email correo] [--limit N] [--skip-files] [--dry-run]');
    return;
  }
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
  let matters = buildMatters(manifest);
  // Primero los expedientes con carpeta (más útiles para pruebas) y los más recientes.
  matters.sort((a, b) => (b.folders.length > 0) - (a.folders.length > 0) || b.reference.localeCompare(a.reference, 'es', { numeric: true }));
  if (options.limit) matters = matters.slice(0, options.limit);
  if (options.dryRun) {
    const statuses = {};
    for (const matter of matters) statuses[matterStatus(matter)] = (statuses[matterStatus(matter)] ?? 0) + 1;
    console.info(JSON.stringify({ mode: 'dry-run', matters: matters.length, withFolders: matters.filter((m) => m.folders.length).length,
      withRegister: matters.filter((m) => m.row).length, statuses }, null, 1));
    return;
  }
  const context = await runtime();
  const started = Date.now();
  try {
    const { prisma, storage, domain } = context;
    const { organization, user, membership, password } = await ensureOrganization(prisma, domain, options);
    if (options.reset) {
      // Sólo para reimportar desde cero en un entorno de prueba: borra expedientes, directorio y formatos de la organización.
      if (!options.resetConfirmed) throw new Error('--reset requiere también --yes-delete-imported-data');
      const where = { organizationId: organization.id };
      const removed = {
        matters: (await prisma.matter.deleteMany({ where })).count,
        personDocuments: (await prisma.document.deleteMany({ where })).count,
        people: (await prisma.person.deleteMany({ where })).count,
        properties: (await prisma.property.deleteMany({ where })).count,
        library: (await prisma.libraryDocument.deleteMany({ where: { ...where, collectionId: LIBRARY_COLLECTION } })).count,
      };
      console.info(`Reinicio: ${JSON.stringify(removed)}`);
    }
    const definitions = (await prisma.requirementDefinition.findMany({ where: { organizationId: organization.id, matterKind: 'MEDIATION_AGREEMENT', active: true } }))
      .map(({ code, label, blocking, appliesToRole, completionMode, sortOrder }) => ({ code, label, blocking, appliesToRole, completionMode, sortOrder }));
    const directory = new Directory(prisma, organization.id);
    await directory.load();
    const ctx = {
      prisma, storage, domain, options, directory, definitions, user, membership, organizationId: organization.id,
      sources: manifest.sources, fileByRel: new Map(manifest.files.filter((f) => f.sha256 && !f.excluded).map((f) => [f.rel, f])),
      caviaceByAgreement: new Map(manifest.caviace.filter((r) => r.agreement).map((r) => [r.agreement, r])),
    };
    const totals = { matters: 0, created: 0, updated: 0, documents: 0, reusedDocuments: 0, duplicateFilesSkipped: 0, statuses: {}, failures: [] };
    for (const [index, matter] of matters.entries()) {
      try {
        const result = await importMatter(ctx, matter);
        totals.matters += 1;
        totals[result.created ? 'created' : 'updated'] += 1;
        totals.documents += result.stored; totals.reusedDocuments += result.reused; totals.duplicateFilesSkipped += result.skipped;
        totals.statuses[result.status] = (totals.statuses[result.status] ?? 0) + 1;
      } catch (error) {
        totals.failures.push({ reference: matter.reference, error: String(error?.message ?? error).slice(0, 300) });
      }
      if ((index + 1) % 250 === 0) console.info(`  ${index + 1}/${matters.length} expedientes, ${totals.documents} documentos, ${Math.round((Date.now() - started) / 1000)} s`);
    }
    totals.clientDocuments = await importClientDocuments(ctx, manifest);
    totals.library = await importLibrary(ctx, manifest);
    totals.people = directory.created.people; totals.properties = directory.created.properties;
    totals.seconds = Math.round((Date.now() - started) / 1000);
    await prisma.auditEvent.create({ data: { organizationId: organization.id, actorUserId: user.id, action: 'CLERC_BACKUP_IMPORTED',
      entityType: 'Organization', entityId: organization.id,
      payload: { ...totals, failures: totals.failures.length, registerFile: manifest.stats?.registerFile ?? null } } });
    console.info(JSON.stringify({ organization: organization.slug, admin: options.adminEmail, ...totals,
      failures: totals.failures.slice(0, 30), failureCount: totals.failures.length }, null, 1));
    if (password) console.info(`\nCuenta creada: ${options.adminEmail} / ${password}\nGuárdala ahora: no se vuelve a mostrar.`);
    return totals;
  } finally { await context.app.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  });
}
