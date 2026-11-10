#!/usr/bin/env node

// Real Nest/HTTP/MCP/PostgreSQL check. Uses only a unique disposable schema and
// a loopback provider stub; it never calls IBM or modifies the public schema.
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
const schema = `ai_usage_check_${randomUUID().replaceAll('-', '')}`;
const rawUrl = process.env.AI_USAGE_TEST_DATABASE_URL
  ?? 'postgresql://despacho:despacho@127.0.0.1:55432/despacho';
const database = new URL(rawUrl);
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname), 'Test database must be local');
assert.equal(database.port, '55432', 'Test database must use the isolated local PostgreSQL port');
assert.equal(database.pathname, '/despacho');
assert.match(schema, /^ai_usage_check_[a-f0-9]{32}$/);
database.searchParams.set('schema', schema);
const scopedUrl = database.toString();
database.searchParams.delete('schema');
const admin = new PrismaClient({ datasources: { db: { url: database.toString() } } });
const prisma = new PrismaClient({ datasources: { db: { url: scopedUrl } } });
const scratch = await mkdtemp(join(tmpdir(), 'despacho-ai-usage-'));
const apiUrl = 'http://127.0.0.1:4100/api';
const unitCost = new Prisma.Decimal('0.000123');
const report = { schema, passed: [], providerRequests: 0, externalRequests: 0, cleaned: false };
let api;
let stub;
let apiLog = '';
let documentId;
let mode = 'extract';
let schemaCreated = false;
let apiEnvironment;
let token;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function checked(label) {
  report.passed.push(label);
  console.log(`✓ ${label}`);
}

async function child(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    const process = spawn(command, args, { cwd: root, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.on('data', (chunk) => { output += chunk; });
    process.stderr.on('data', (chunk) => { output += chunk; });
    process.on('error', reject);
    process.on('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}: ${output.slice(-5000)}`)));
  });
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.token !== false && (options.token ?? token)) headers.set('Authorization', `Bearer ${options.token ?? token}`);
  const json = options.body && !(options.body instanceof FormData);
  if (json) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiUrl}${path}`, {
    ...options, headers, body: json ? JSON.stringify(options.body) : options.body,
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (options.expectedStatus) assert.equal(response.status, options.expectedStatus, `${path}: ${JSON.stringify(body)}`);
  else assert.ok(response.ok, `${path}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function startApi() {
  apiLog = '';
  api = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root, env: apiEnvironment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => { apiLog = (apiLog + chunk).slice(-20_000); };
  api.stdout.on('data', collect);
  api.stderr.on('data', collect);
  api.on('error', collect);
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) throw new Error(`Isolated API failed to start: ${apiLog.slice(-6000)}`);
    try {
      const response = await fetch(`${apiUrl}/health/ready`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await pause(200);
  }
  throw new Error(`Isolated API startup timed out: ${apiLog.slice(-6000)}`);
}

async function stopApi() {
  if (!api || api.exitCode !== null) return;
  const running = api;
  const exited = new Promise((resolve) => running.once('exit', resolve));
  running.kill('SIGTERM');
  const timer = setTimeout(() => running.kill('SIGKILL'), 5_000);
  await exited;
  clearTimeout(timer);
  api = undefined;
}

try {
  // Refuse to reuse or stop somebody else's process on the test API port.
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(4100, '127.0.0.1', resolve));
  await new Promise((resolve) => probe.close(resolve));
  await readFile(join(root, 'apps/api/dist/ai-usage/usage-correlation.interceptor.js'));
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await child(join(root, 'packages/database/node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: join(root, 'packages/database'), env: { ...process.env, DATABASE_URL: scopedUrl },
  });
  checked('Migraciones aplicadas en schema PostgreSQL único; public no se modifica');

  // Generate a fresh throwaway credential for this isolated test run.
  const password = randomBytes(32).toString('base64url');
  const passwordHash = await hash(password, 4);
  const organization = await prisma.organization.create({ data: { name: 'AI usage check', slug: schema } });
  const person = await prisma.user.create({ data: { email: `owner-${schema}@example.test`, displayName: 'Fixture owner', passwordHash } });
  const other = await prisma.user.create({ data: { email: `other-${schema}@example.test`, displayName: 'Fixture other', passwordHash } });
  await prisma.membership.createMany({ data: [person, other].map((user) => ({ organizationId: organization.id, userId: user.id, role: 'ADMIN' })) });
  const matter = await prisma.matter.create({ data: {
    organizationId: organization.id, createdById: person.id, kind: 'LEASE', reference: 'USAGE-001', title: 'Fixture only',
  } });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhqsAAAAASUVORK5CYII=', 'base64');
  const key = `fixture/${randomUUID()}.png`;
  await mkdir(join(scratch, 'fixture'), { recursive: true });
  await writeFile(join(scratch, key), png);
  const document = await prisma.document.create({ data: {
    organizationId: organization.id, uploadedById: person.id, matterId: matter.id, type: 'TENANT_ID',
    originalName: 'usage-fixture.png', objectKey: key, bucket: 'test-local', mimeType: 'image/png', sizeBytes: png.length,
  } });
  documentId = document.id;

  stub = createServer(async (incoming, response) => {
    try {
      assert.equal(incoming.method, 'POST');
      assert.equal(incoming.url, '/v1/responses');
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(incoming.headers.authorization, 'Bearer local-stub-only');
      assert.ok(incoming.headers['x-client-request-id'], 'Every physical request must carry the persisted attempt ID');
      report.providerRequests += 1;
      let output;
      const format = body.text?.format?.name;
      if (format === 'ine_fields' || format === 'chat_document_fields') {
        output = { output: [], output_text: JSON.stringify({ documentKind: 'INE', fields: { legalName: 'Persona de prueba', givenName: 'Persona' } }) };
      } else if (mode === 'unpriced' || body.input.some((item) => item.type === 'function_call_output' && item.call_id === 'extract-fixture')) {
        output = { output: [], output_text: 'La extracción está lista para revisión.' };
      } else {
        const extraction = body.tools.find((tool) => tool.name === 'despacho_documents_extract');
        const name = extraction?.name ?? 'assistant_find_tools';
        const args = extraction ? { params: { id: documentId }, body: { mode: 'ai' } } : { query: 'extraer extracción lectura documento' };
        output = { output: [{ type: 'function_call', call_id: extraction ? 'extract-fixture' : `find-${report.providerRequests}`, name, arguments: JSON.stringify(args) }] };
      }
      response.writeHead(200, {
        'Content-Type': 'application/json', 'x-request-id': `stub-${report.providerRequests}`,
        ...(mode === 'unpriced' ? {} : { 'x-fixture-cost': unitCost.toFixed() }),
      });
      response.end(JSON.stringify({ id: `response-${report.providerRequests}`, model: 'fixture-model', status: 'completed',
        usage: { input_tokens: 100, output_tokens: 20 }, ...output }));
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const providerUrl = `http://127.0.0.1:${stub.address().port}`;
  apiEnvironment = {
    ...process.env, NODE_ENV: 'test', API_PORT: '4100', DATABASE_URL: scopedUrl,
    WEB_ORIGIN: 'http://localhost:3000', JWT_SECRET: `usage-check-${randomUUID()}-${randomUUID()}`,
    COOKIE_SECURE: 'false', STORAGE_DRIVER: 'local', LOCAL_STORAGE_PATH: scratch,
    PASSWORD_RECOVERY_DRIVER: 'local', MCP_ENABLED: 'true', MCP_LOCAL_ONLY: 'true',
    MCP_INTERNAL_API_URL: apiUrl, MCP_OUTPUT_DIR: join(scratch, 'mcp-output'),
    ASSISTANT_ENABLED: 'true', ASSISTANT_API_BASE_URL: providerUrl,
    ASSISTANT_API_KEY: 'local-stub-only', ICA_API_KEY: 'local-stub-only',
    ASSISTANT_API_KEY_HEADER: 'Authorization', ASSISTANT_API_KEY_SCHEME: 'Bearer',
    ASSISTANT_MODEL: 'fixture-model', ASSISTANT_RESPONSES_PATH: '',
    ASSISTANT_MCP_URL: 'http://127.0.0.1:4100/mcp', DOCUMENT_EXTRACTION_ENABLED: 'true',
    AI_USAGE_PROVIDER_COST_HEADER: 'x-fixture-cost', AI_USAGE_PROVIDER_COST_CURRENCY: 'USD',
    AI_USAGE_PROVIDER_COST_JSON_PATH: '', ICA_BUDGET_URL: '',
  };
  await startApi();
  checked('Aplicación Nest completa inicia y pasa health/ready en puerto 4100');
  const login = await request('/auth/login', { method: 'POST', token: false, body: { email: person.email, password } });
  token = login.accessToken;
  const { id: conversationId } = await request('/ai-usage/conversations', { method: 'POST' });
  const proposal = await request('/assistant/chat', { method: 'POST', body: {
    conversationId, messages: [{ role: 'user', content: `Solicita la extracción de texto del documento INE ${documentId} del expediente ${matter.id}.` }],
  } });
  assert.ok(proposal.pendingAction, `Expected confirmed extraction proposal: ${JSON.stringify(proposal)}`);
  assert.equal(proposal.conversationId, conversationId);
  const afterProposal = report.providerRequests;
  const confirmation = await request(`/assistant/actions/${proposal.pendingAction.id}`, { method: 'POST', body: { approved: true } });
  assert.equal(confirmation.changed, true, JSON.stringify(confirmation));
  assert.equal(confirmation.conversationId, conversationId);
  assert.equal(report.providerRequests, afterProposal + 2, 'Extraction plus final summary must each issue exactly one provider request');

  const summary = await request(`/ai-usage/summary?conversationId=${conversationId}`);
  assert.equal(summary.budget.status, 'unavailable', 'Unconfigured IBM contract must remain unavailable');
  assert.equal(summary.conversation.requestCount, report.providerRequests);
  assert.equal(summary.conversation.amount, unitCost.times(report.providerRequests).toFixed());
  assert.equal(summary.conversation.pendingCount, 0);
  const extraction = await prisma.aiOperation.findFirst({ where: { conversationId, kind: 'DOCUMENT_EXTRACTION', documentId } });
  assert.ok(extraction?.parentId, 'Extraction must inherit the chat action across the real MCP HTTP boundary');
  const parent = await prisma.aiOperation.findUnique({ where: { id: extraction.parentId } });
  assert.equal(parent.kind, 'ACTION');
  assert.equal(parent.conversationId, conversationId);
  const extractionAttempts = await prisma.aiUsageAttempt.findMany({ where: { operationId: extraction.id } });
  assert.equal(extractionAttempts.length, 1);
  assert.equal(extractionAttempts[0].confirmedCost.toFixed(), unitCost.toFixed());
  assert.equal(extractionAttempts[0].userId, person.id);
  assert.equal(extractionAttempts[0].organizationId, organization.id);
  checked('Chat → confirmación → MCP HTTP → extracción conserva conversación, usuario y costo directo sin duplicados');

  await request(`/documents/${documentId}/extraction`, { method: 'POST', body: { mode: 'ai' } });
  assert.equal(report.providerRequests, summary.conversation.requestCount);
  checked('Reutilizar extracción pendiente no vuelve a llamar al proveedor ni agrega consumo');

  const form = new FormData();
  form.append('files', new Blob([png], { type: 'image/png' }), 'attachment-fixture.png');
  const staged = await request(`/assistant/attachments?conversationId=${conversationId}&extractionMode=ai`, { method: 'POST', body: form });
  assert.equal(staged.attachments.length, 1);
  const costAfterAttachment = unitCost.times(report.providerRequests).toFixed();
  assert.equal((await request(`/ai-usage/summary?conversationId=${conversationId}`)).conversation.amount, costAfterAttachment);
  await request(`/assistant/attachments/${staged.attachments[0].id}`, { method: 'DELETE' });
  assert.equal((await request(`/ai-usage/summary?conversationId=${conversationId}`)).conversation.amount, costAfterAttachment);
  checked('El adjunto se contabiliza antes del mensaje y descartarlo conserva el gasto');

  const { id: freshConversation } = await request('/ai-usage/conversations', { method: 'POST' });
  const freshSummary = await request(`/ai-usage/summary?conversationId=${freshConversation}`);
  assert.equal(freshSummary.conversation.requestCount, 0);
  assert.equal(freshSummary.personal.amount, costAfterAttachment);
  const otherLogin = await request('/auth/login', { method: 'POST', token: false, body: { email: other.email, password } });
  await request(`/ai-usage/summary?conversationId=${conversationId}`, { token: otherLogin.accessToken, expectedStatus: 404 });
  const otherSummary = await request('/ai-usage/summary', { token: otherLogin.accessToken });
  assert.equal(otherSummary.personal.requestCount, 0);
  checked('Nueva conversación conserva consumo personal; otro usuario no ve el chat ni sus costos');

  await stopApi();
  await startApi();
  assert.equal((await request(`/ai-usage/summary?conversationId=${conversationId}`)).conversation.amount, costAfterAttachment);
  checked('Reiniciar la API conserva conversación y costos persistidos');

  mode = 'unpriced';
  // A new plain turn deliberately has no known billing field. It must stay pending.
  const pending = await request('/assistant/chat', { method: 'POST', body: {
    conversationId: freshConversation, messages: [{ role: 'user', content: 'Hola' }],
  } });
  assert.ok(pending.message);
  const pendingSummary = await request(`/ai-usage/summary?conversationId=${freshConversation}`);
  assert.ok(pendingSummary.conversation.pendingCount > 0);
  assert.equal(pendingSummary.conversation.amount, null);
  checked('Respuestas sin costo verificado se muestran pendientes, sin inventar costo cero');

  report.finalConfirmedAmount = costAfterAttachment;
  report.currency = 'USD';
  report.success = true;
} catch (error) {
  report.success = false;
  report.error = error.message;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await stopApi();
  if (stub) {
    stub.closeAllConnections();
    await new Promise((resolve) => stub.close(resolve));
  }
  await prisma.$disconnect();
  if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.$disconnect();
  await rm(scratch, { recursive: true, force: true });
  report.cleaned = true;
  report.completedAt = new Date().toISOString();
  const output = join(root, 'artifacts/ai-usage-integration-check.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Resultado: ${output}`);
}
