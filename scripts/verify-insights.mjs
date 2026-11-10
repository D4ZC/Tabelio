#!/usr/bin/env node

// Real Nest/HTTP/PostgreSQL verification. Only synthetic records and a loopback
// provider stub are used. Build the API before running; public is never changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from 'bcryptjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { PrismaClient, Prisma } = require('@despacho/database');
const schema = `insights_check_${randomUUID().replaceAll('-', '')}`;
const database = new URL(process.env.INSIGHTS_TEST_DATABASE_URL ?? 'postgresql://despacho:despacho@127.0.0.1:55432/despacho');
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname), 'Verification database must be local');
assert.equal(database.port, '55432', 'Verification requires the isolated PostgreSQL port');
assert.equal(database.pathname, '/despacho');
assert.match(schema, /^insights_check_[a-f0-9]{32}$/);
database.searchParams.set('schema', schema);
const scopedUrl = database.toString();
database.searchParams.delete('schema');
const admin = new PrismaClient({ datasources: { db: { url: database.toString() } } });
const prisma = new PrismaClient({ datasources: { db: { url: scopedUrl } } });
const scratch = await mkdtemp(join(tmpdir(), 'despacho-insights-'));
const externalLog = join(scratch, 'external-fetch-attempts.txt');
const evidence = join(root, 'artifacts/insights-integration-check.json');
const unitCost = new Prisma.Decimal('0.000123');
const report = {
  syntheticDataOnly: true, provider: 'loopback-stub', databaseSchema: schema,
  passed: [], providerRequests: 0, externalRequests: 0, success: false, cleaned: false,
};
let stage = 'preparación';
let api;
let apiLog = '';
let stub;
let apiUrl;
let apiPort;
let apiEnvironment;
let schemaCreated = false;
let token;
let badCitation = false;
const providerKinds = [];
const stubFailures = [];
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function checked(label) {
  report.passed.push(label);
  console.log(`✓ ${label}`);
}

async function child(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd: root, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.resume();
    process.stderr.resume();
    process.once('error', reject);
    process.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Verification subprocess exited ${code}`)));
  });
}

async function choosePort() {
  for (const port of [4110, 4111]) {
    const probe = createServer();
    try {
      await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
      await new Promise((resolve) => probe.close(resolve));
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('Verification ports 4110 and 4111 are already in use; no process was stopped');
}

async function request(path, { body, expectedStatus, token: requestToken = token, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (requestToken) headers.set('Authorization', `Bearer ${requestToken}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiUrl}${path}`, {
    ...options, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, expectedStatus ?? (options.method === 'POST' ? 201 : 200), `Unexpected HTTP status at ${path}`);
  return response.json();
}

async function startApi() {
  apiLog = '';
  api = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root, env: apiEnvironment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => { apiLog = `${apiLog}${chunk}`.slice(-20_000); };
  api.stdout.on('data', collect);
  api.stderr.on('data', collect);
  api.on('error', collect);
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) throw new Error('Isolated API failed to start');
    try {
      const response = await fetch(`${apiUrl}/health/ready`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await pause(200);
  }
  throw new Error('Isolated API startup timed out');
}

async function stopApi() {
  if (!api || api.exitCode !== null) return;
  const ownedProcess = api;
  const exited = new Promise((resolve) => ownedProcess.once('exit', resolve));
  ownedProcess.kill('SIGTERM');
  const timer = setTimeout(() => ownedProcess.kill('SIGKILL'), 5_000);
  await exited;
  clearTimeout(timer);
  api = undefined;
}

async function ledgerCounts() {
  return {
    operations: await prisma.aiOperation.count(), attempts: await prisma.aiUsageAttempt.count(),
    conversations: await prisma.aiConversation.count(),
  };
}

// Audit and usage metadata may be appended; the source domain records must stay identical.
async function domainSnapshot() {
  const models = ['matter', 'person', 'property', 'matterParty', 'leaseTerms', 'checklistItem', 'task', 'document', 'documentExtractionRun', 'documentExtractionReview'];
  const values = {};
  for (const model of models) values[model] = await prisma[model].findMany({ orderBy: { id: 'asc' } });
  return JSON.stringify(values);
}

function assertResult(result, kind, mode) {
  assert.equal(result.kind, kind);
  assert.equal(result.mode, mode);
  assert.ok(result.title?.trim() && result.summary?.trim());
  assert.ok(Array.isArray(result.items) && Array.isArray(result.sources) && Array.isArray(result.limitations));
  assert.ok(result.sources.length > 0 && result.sources.length <= 20);
  const ids = new Set(result.sources.map((source) => source.id));
  for (const source of result.sources) assert.deepEqual(Object.keys(source).sort(), ['id', 'label']);
  for (const item of result.items) {
    assert.ok(['info', 'warning', 'high'].includes(item.severity));
    assert.ok(item.sourceIds.length > 0 && item.sourceIds.every((id) => ids.has(id)));
  }
  assert.equal(Object.hasOwn(result, 'suggestedDocumentKind'), false);
}

function comparableFacts(facts) {
  if (!facts) return facts;
  const copy = structuredClone(facts);
  // Each analysis evaluates the same facts at its own current time. Keep all
  // facts under deep equality while validating this one computed timestamp.
  if (copy.consistency && Object.hasOwn(copy.consistency, 'evaluatedAt')) {
    const timestamp = copy.consistency.evaluatedAt;
    assert.equal(typeof timestamp, 'string');
    assert.equal(new Date(timestamp).toISOString(), timestamp);
    copy.consistency.evaluatedAt = '<validated-evaluation-time>';
  }
  return copy;
}

try {
  apiPort = await choosePort();
  apiUrl = `http://127.0.0.1:${apiPort}/api`;
  await readFile(join(root, 'apps/api/dist/insights/insights.controller.js'));
  const { createZipArchive } = require(join(root, 'apps/api/dist/documents/docx-template.js'));
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await child(join(root, 'packages/database/node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: join(root, 'packages/database'), env: { ...process.env, DATABASE_URL: scopedUrl },
  });
  checked('Migraciones en schema temporal único; public permanece intacto');

  stage = 'datos sintéticos';
  // Generate a fresh throwaway credential for this isolated test run.
  const password = randomBytes(32).toString('base64url');
  const passwordHash = await hash(password, 4);
  const organization = await prisma.organization.create({ data: { name: 'Synthetic insights organization', slug: schema } });
  const foreignOrganization = await prisma.organization.create({ data: { name: 'Synthetic foreign organization', slug: `${schema}_foreign` } });
  const users = {};
  for (const [name, role, organizationId] of [['owner', 'ADMIN', organization.id], ['viewer', 'VIEWER', organization.id], ['foreign', 'ADMIN', foreignOrganization.id]]) {
    users[name] = await prisma.user.create({ data: { email: `${name}-${schema}@example.test`, displayName: `Synthetic ${name}`, passwordHash } });
    await prisma.membership.create({ data: { organizationId, userId: users[name].id, role } });
  }
  const parties = [];
  for (const [role, name] of [['LANDLORD', 'Persona Sintética Propietaria'], ['TENANT', 'Persona Sintética Arrendataria'], ['GUARANTOR', 'Persona Sintética Obligada']]) {
    const person = await prisma.person.create({ data: { organizationId: organization.id, legalName: name, postalCode: '44100' } });
    parties.push({ role, person });
  }
  const property = await prisma.property.create({ data: {
    organizationId: organization.id, displayName: 'Inmueble Sintético', addressLine1: 'Calle de Prueba 123', city: 'Ciudad Ejemplo', state: 'Estado Ejemplo', postalCode: '44100', ownerPersonId: parties[0].person.id,
  } });
  const matter = await prisma.matter.create({ data: {
    organizationId: organization.id, createdById: users.owner.id, kind: 'LEASE', reference: 'INSIGHTS-SYNTHETIC-001',
    title: 'Expediente sintético para verificar análisis', propertyId: property.id,
    notes: 'Nota sintética de seguimiento sin datos personales reales. '.repeat(150),
  } });
  await prisma.matterParty.createMany({ data: parties.map(({ role, person }) => ({ organizationId: organization.id, matterId: matter.id, role, personId: person.id })) });
  await prisma.leaseTerms.create({ data: {
    organizationId: organization.id, matterId: matter.id, rentAmount: 10000, currency: 'MXN', depositAmount: 10000,
    startDate: new Date('2030-01-01T00:00:00Z'), endDate: new Date('2030-12-31T00:00:00Z'), durationMonths: 12,
  } });
  await prisma.checklistItem.create({ data: {
    organizationId: organization.id, matterId: matter.id, code: 'SYNTHETIC_MANUAL_REVIEW', label: 'Revisión sintética pendiente', completionMode: 'MANUAL', status: 'PENDING', blocking: true,
  } });
  await prisma.task.createMany({ data: ['TODO', 'BLOCKED', 'DONE'].map((status, index) => ({
    organizationId: organization.id, matterId: matter.id, createdById: users.owner.id, title: `Tarea sintética ${index + 1}`, status,
  })) });
  await mkdir(join(scratch, 'fixtures'), { recursive: true });
  const docx = (paragraphs) => createZipArchive([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/document.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')}<w:sectPr/></w:body></w:document>`) },
  ]);
  const drafts = [];
  for (const version of [1, 2]) {
    const buffer = docx(['BORRADOR COMPLETAMENTE SINTETICO', `Renta mensual de prueba: ${version === 1 ? '10000' : '11000'} pesos.`, ...(version === 2 ? ['Nuevo párrafo sintético para revisión.'] : [])]);
    const objectKey = `fixtures/synthetic-v${version}.docx`;
    await writeFile(join(scratch, objectKey), buffer, { mode: 0o600 });
    drafts.push(await prisma.document.create({ data: {
      organizationId: organization.id, uploadedById: users.owner.id, matterId: matter.id, type: 'DRAFT_CONTRACT', version,
      originalName: `synthetic-v${version}.docx`, objectKey, bucket: 'synthetic-local', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: buffer.length,
    } }));
  }
  const classificationDocument = await prisma.document.create({ data: {
    organizationId: organization.id, uploadedById: users.owner.id, matterId: matter.id, personId: parties[1].person.id, type: 'OTHER',
    originalName: 'synthetic-identification.png', objectKey: 'fixtures/no-original-required.png', bucket: 'synthetic-local', mimeType: 'image/png', sizeBytes: 100,
    extractionStatus: 'COMPLETE', extractedData: { legalName: 'Persona Sintética con Diferencia', postalCode: '99999' },
  } });
  await prisma.documentExtractionRun.create({ data: {
    organizationId: organization.id, documentId: classificationDocument.id, requestedById: users.owner.id,
    provider: 'local-ocr', status: 'MANUAL_REVIEW', rawData: {
      extractedText: 'INSTITUTO NACIONAL ELECTORAL\nCREDENCIAL PARA VOTAR\nNOMBRE COMPLETO: PERSONA SINTETICA DE PRUEBA\nDOMICILIO: CALLE SINTETICA 123\nCODIGO POSTAL: 44100',
    },
  } });
  const routes = [
    { kind: 'summary', path: `/insights/matters/${matter.id}/summary`, operation: 'INSIGHT_SUMMARY' },
    { kind: 'consistency', path: `/insights/matters/${matter.id}/consistency`, operation: 'INSIGHT_CONSISTENCY' },
    { kind: 'comparison', path: `/insights/documents/${drafts[1].id}/comparison`, operation: 'INSIGHT_COMPARISON', documentId: drafts[1].id },
    { kind: 'classification', path: `/insights/documents/${classificationDocument.id}/classification`, operation: 'INSIGHT_CLASSIFICATION', documentId: classificationDocument.id },
  ];
  checked('Expediente, participantes, notas, tareas, extracción y dos DOCX válidos creados sólo con datos sintéticos');

  stage = 'proveedor loopback y arranque';
  stub = createServer(async (incoming, outgoing) => {
    try {
      assert.equal(incoming.method, 'POST');
      assert.equal(incoming.url, '/v1/responses');
      assert.equal(incoming.headers.authorization, 'Bearer local-insights-stub-only');
      const attemptId = incoming.headers['x-client-request-id'];
      assert.equal(typeof attemptId, 'string');
      const attempt = await prisma.aiUsageAttempt.findUnique({ where: { id: attemptId } });
      assert.equal(attempt?.state, 'STARTED', 'Attempt must exist before the provider request');
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.deepEqual(body.tools, []);
      assert.equal(body.tool_choice, 'none');
      assert.equal(body.text.format.strict, true);
      assert.ok(body.text.format.name.startsWith('insight_'));
      const kind = body.text.format.name.slice('insight_'.length);
      assert.ok(routes.some((route) => route.kind === kind));
      const data = JSON.parse(body.input[0].content[0].text);
      assert.ok(data.sources.length > 0 && data.sources.length <= 20);
      assert.ok(data.sources.every((source) => source.text.trim() && source.text.length <= 6000));
      assert.ok(data.sources.reduce((sum, source) => sum + source.text.length, 0) <= 40000);
      const ids = new Set(data.sources.map((source) => source.id));
      assert.equal(ids.size, data.sources.length);
      assert.ok(data.localResult.items.every((item) => item.sourceIds.length > 0 && item.sourceIds.every((id) => ids.has(id))));
      assert.equal(JSON.stringify(body).includes('local-insights-stub-only'), false);
      report.providerRequests += 1;
      providerKinds.push(kind);
      const result = {
        title: 'Análisis sintético para revisión', summary: 'Las fuentes sintéticas permiten revisar la información registrada.',
        items: [{ title: 'Revisión sintética', detail: 'Información de prueba para revisión humana.', severity: 'info', sourceIds: [badCitation ? 'foreign-source-never-allowed' : data.sources[0].id] }],
        ...(kind === 'classification' ? { suggestedDocumentKind: 'IDENTIFICATION' } : {}),
      };
      outgoing.writeHead(200, { 'Content-Type': 'application/json', 'x-request-id': `insights-stub-${report.providerRequests}`, 'x-fixture-cost': unitCost.toFixed() });
      outgoing.end(JSON.stringify({
        id: `synthetic-response-${report.providerRequests}`, model: 'synthetic-insights-model', status: 'completed',
        usage: { input_tokens: 100, output_tokens: 20 }, output: [], output_text: JSON.stringify(result),
      }));
    } catch {
      stubFailures.push('Provider request did not match the synthetic integration contract');
      outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: { message: 'Synthetic provider contract failed' } }));
    }
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const guard = join(scratch, 'network-guard.cjs');
  await writeFile(guard, `const fs = require('node:fs');
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    fs.appendFileSync(${JSON.stringify(externalLog)}, 'blocked\\n');
    throw new Error('External fetch is disabled during integration verification');
  }
  return originalFetch(input, options);
};\n`, { mode: 0o600 });
  apiEnvironment = {
    ...process.env, NODE_ENV: 'test', NODE_OPTIONS: `--require ${guard}`, API_PORT: String(apiPort), DATABASE_URL: scopedUrl,
    WEB_ORIGIN: 'http://localhost:3000', JWT_SECRET: `insights-check-${randomUUID()}-${randomUUID()}`, COOKIE_SECURE: 'false',
    STORAGE_DRIVER: 'local', LOCAL_STORAGE_PATH: scratch, PASSWORD_RECOVERY_DRIVER: 'local', MCP_ENABLED: 'false',
    ASSISTANT_ENABLED: 'true', ASSISTANT_API_BASE_URL: `http://127.0.0.1:${stub.address().port}`,
    ASSISTANT_API_KEY: 'local-insights-stub-only', ICA_API_KEY: 'local-insights-stub-only',
    ASSISTANT_API_KEY_HEADER: 'Authorization', ASSISTANT_API_KEY_SCHEME: 'Bearer', ASSISTANT_MODEL: 'synthetic-insights-model', ASSISTANT_RESPONSES_PATH: '',
    DOCUMENT_EXTRACTION_ENABLED: 'false', LOCAL_OCR_ENABLED: 'false',
    AI_USAGE_PROVIDER_COST_HEADER: 'x-fixture-cost', AI_USAGE_PROVIDER_COST_CURRENCY: 'USD', AI_USAGE_PROVIDER_COST_JSON_PATH: '', AI_USAGE_PRICING_JSON: '', ICA_BUDGET_URL: '',
  };
  await startApi();
  report.apiPort = apiPort;
  checked('Nest inicia en puerto libre 4110/4111 con proveedor loopback y bloqueo de fetch externo');
  const tokens = {};
  for (const [name, user] of Object.entries(users)) {
    tokens[name] = (await request('/auth/login', { method: 'POST', token: false, body: { email: user.email, password } })).accessToken;
  }
  token = tokens.owner;

  stage = 'settings y permisos';
  const settings = await request('/insights/settings');
  assert.deepEqual(settings, { aiEnabled: true, provider: '127.0.0.1' });
  assert.deepEqual(Object.keys(settings).sort(), ['aiEnabled', 'provider']);
  await request('/insights/settings', { token: false, expectedStatus: 401 });
  for (const route of routes) {
    await request(route.path, { method: 'POST', token: false, body: { mode: 'ai' }, expectedStatus: 401 });
    await request(route.path, { method: 'POST', token: tokens.foreign, body: { mode: 'ai' }, expectedStatus: 404 });
    await request(route.path, { method: 'POST', body: { mode: 'invalid' }, expectedStatus: 400 });
  }
  assert.equal(report.providerRequests, 0);
  assert.deepEqual(await ledgerCounts(), { operations: 0, attempts: 0, conversations: 0 });
  checked('Settings sin secretos; cuatro rutas rechazan sesión ausente401, otra organización404 y modo inválido400 antes del consumo');

  stage = 'cuatro análisis locales';
  const beforeDomain = await domainSnapshot();
  const locals = {};
  for (const route of routes) {
    locals[route.kind] = await request(route.path, { method: 'POST', body: {} });
    assertResult(locals[route.kind], route.kind, 'local');
    const explicit = await request(route.path, { method: 'POST', body: { mode: 'local' } });
    for (const key of ['title', 'summary', 'items', 'facts', 'suggestion']) {
      assert.deepEqual(key === 'facts' ? comparableFacts(explicit[key]) : explicit[key], key === 'facts' ? comparableFacts(locals[route.kind][key]) : locals[route.kind][key]);
    }
  }
  assert.equal(locals.summary.facts.parties, 3);
  assert.equal(locals.summary.facts.tasks, 3);
  assert.equal(locals.summary.facts.documents, 3);
  assert.ok(locals.summary.limitations.some((limitation) => /limitad/i.test(limitation)));
  assert.ok(locals.consistency.items.some((item) => /diferente entre documento y ficha/i.test(item.title)));
  assert.equal(locals.comparison.facts.changedParagraphs, 2);
  assert.deepEqual(locals.classification.suggestion, { documentType: 'OTHER' });
  assert.equal(report.providerRequests, 0);
  assert.deepEqual(await ledgerCounts(), { operations: 0, attempts: 0, conversations: 0 });
  assert.equal(await domainSnapshot(), beforeDomain);
  checked('Cuatro funciones locales por omisión y explícitas sin proveedor, ledger ni cambios de datos; límites visibles y comparación DOCX real');
  await request(routes[0].path, { method: 'POST', token: tokens.viewer, body: { mode: 'local' } });
  await request(routes[3].path, { method: 'POST', token: tokens.viewer, body: { mode: 'local' } });
  await request(`/documents/${classificationDocument.id}/classification`, { method: 'PATCH', token: tokens.viewer, body: { type: 'TENANT_ID' }, expectedStatus: 403 });
  assert.equal(await domainSnapshot(), beforeDomain);
  checked('VIEWER puede consultar análisis y recibe403 al intentar aplicar clasificación');

  stage = 'cuatro análisis IA explícitos';
  const conversationId = (await request('/ai-usage/conversations', { method: 'POST' })).id;
  for (const route of routes) {
    const result = await request(route.path, { method: 'POST', body: { mode: 'ai', conversationId } });
    assertResult(result, route.kind, 'ai');
    assert.deepEqual(comparableFacts(result.facts), comparableFacts(locals[route.kind].facts));
    if (route.kind === 'classification') assert.deepEqual(result.suggestion, { documentType: 'OTHER' });
    const operation = await prisma.aiOperation.findFirst({ where: { conversationId, kind: route.operation }, include: { attempts: true } });
    assert.equal(operation.userId, users.owner.id);
    assert.equal(operation.organizationId, organization.id);
    assert.equal(operation.status, 'COMPLETED');
    assert.equal(operation.documentId, route.documentId ?? null);
    assert.equal(operation.attempts.length, 1);
    const attempt = operation.attempts[0];
    assert.equal(attempt.state, 'CONFIRMED');
    assert.equal(attempt.inputTokens, 100);
    assert.equal(attempt.outputTokens, 20);
    assert.equal(attempt.confirmedCost.toFixed(), unitCost.toFixed());
    assert.equal(attempt.currency, 'USD');
  }
  assert.deepEqual(providerKinds, routes.map((route) => route.kind));
  assert.equal(report.providerRequests, 4);
  assert.equal(await domainSnapshot(), beforeDomain);
  const firstUsage = await request(`/ai-usage/summary?conversationId=${conversationId}`);
  assert.equal(firstUsage.conversation.requestCount, 4);
  assert.equal(firstUsage.conversation.amount, unitCost.times(4).toFixed());
  assert.equal(firstUsage.conversation.inputTokens, 400);
  assert.equal(firstUsage.conversation.outputTokens, 80);
  checked('Cuatro funciones IA explícitas conservan hechos y datos; cada llamada registra usuario, conversación, documento, tokens y coste confirmado');

  stage = 'cita ajena y consumo conservado';
  badCitation = true;
  const failure = await request(routes[0].path, { method: 'POST', body: { mode: 'ai', conversationId }, expectedStatus: 502 });
  assert.equal(JSON.stringify(failure).includes('foreign-source-never-allowed'), false);
  assert.equal(await domainSnapshot(), beforeDomain);
  assert.equal(report.providerRequests, 5);
  const operations = await prisma.aiOperation.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' }, include: { attempts: true } });
  assert.equal(operations.length, 5);
  assert.equal(operations.filter((operation) => operation.status === 'FAILED').length, 1);
  assert.equal(operations.filter((operation) => operation.status === 'COMPLETED').length, 4);
  assert.ok(operations.every((operation) => operation.attempts.length === 1 && operation.attempts[0].state === 'CONFIRMED'));
  const finalUsage = await request(`/ai-usage/summary?conversationId=${conversationId}`);
  assert.equal(finalUsage.conversation.requestCount, 5);
  assert.equal(finalUsage.conversation.amount, unitCost.times(5).toFixed());
  assert.equal(finalUsage.conversation.inputTokens, 500);
  assert.equal(finalUsage.conversation.outputTokens, 100);
  checked('Cita ajena devuelve502 sin fallback ni cambios; el coste y los tokens de la llamada rechazada siguen registrados');

  stage = 'local independiente con IA desactivada';
  await stopApi();
  apiEnvironment = { ...apiEnvironment, ASSISTANT_ENABLED: 'false', ASSISTANT_API_KEY: '' };
  await startApi();
  assert.deepEqual(await request('/insights/settings'), { aiEnabled: false, provider: '127.0.0.1' });
  const beforeDisabled = await ledgerCounts();
  for (const route of routes) {
    assertResult(await request(route.path, { method: 'POST', body: { mode: 'local' } }), route.kind, 'local');
    await request(route.path, { method: 'POST', body: { mode: 'ai', conversationId }, expectedStatus: 503 });
  }
  assert.deepEqual(await ledgerCounts(), beforeDisabled);
  assert.equal(report.providerRequests, 5);
  assert.equal(await domainSnapshot(), beforeDomain);
  assert.deepEqual(stubFailures, []);
  checked('Las cuatro funciones locales siguen disponibles con IA desactivada; AI devuelve503 sin consumo adicional');

  report.operationKinds = operations.map((operation) => ({ kind: operation.kind, status: operation.status }));
  report.localEndpointsVerified = 4;
  report.aiEndpointsVerified = 4;
  report.attemptCount = 5;
  report.confirmedAmount = finalUsage.conversation.amount;
  report.currency = finalUsage.conversation.currency;
  report.inputTokens = finalUsage.conversation.inputTokens;
  report.outputTokens = finalUsage.conversation.outputTokens;
  report.success = true;
} catch (error) {
  report.success = false;
  report.failureStage = stage;
  report.failureType = error?.name ?? 'Error';
  console.error(`Falló la verificación en «${stage}» (${report.failureType}).`);
  // Only synthetic test diagnostics; never persisted in the evidence artifact.
  if (error?.code === 'ERR_ASSERTION') console.error(error.message);
  else if (/arranque|preparación/.test(stage)) console.error(apiLog.slice(-5000) || error.message);
  process.exitCode = 1;
} finally {
  const cleanupFailures = [];
  try { await stopApi(); } catch { cleanupFailures.push('api'); }
  if (stub) {
    try { stub.closeAllConnections(); await new Promise((resolve) => stub.close(resolve)); } catch { cleanupFailures.push('stub'); }
  }
  try { report.externalRequests = (await readFile(externalLog, 'utf8')).split('\n').filter(Boolean).length; }
  catch (error) { if (error.code !== 'ENOENT') cleanupFailures.push('network-evidence'); }
  if (report.externalRequests > 0) { report.success = false; report.failureStage = 'bloqueo de fetch externo'; process.exitCode = 1; }
  try { await prisma.$disconnect(); } catch { cleanupFailures.push('prisma'); }
  try { if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); } catch { cleanupFailures.push('schema'); }
  try { await admin.$disconnect(); } catch { cleanupFailures.push('admin'); }
  try { await rm(scratch, { recursive: true, force: true }); } catch { cleanupFailures.push('scratch'); }
  report.cleaned = cleanupFailures.length === 0;
  if (cleanupFailures.length) { report.success = false; report.cleanupFailures = cleanupFailures; process.exitCode = 1; }
  report.completedAt = new Date().toISOString();
  await mkdir(dirname(evidence), { recursive: true });
  await writeFile(evidence, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ success: report.success, checks: report.passed.length, providerRequests: report.providerRequests, externalRequests: report.externalRequests, cleaned: report.cleaned, evidence }, null, 2));
}
