import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const sources = Object.fromEntries(await Promise.all(['protocol', 'background', 'ibm-session', 'demo-bridge'].map(async (name) => [name, await readFile(new URL(`${name}.js`, root), 'utf8')])));
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const timer = (callback, ms) => { const handle = setTimeout(callback, ms); handle.unref(); return handle; };
const base = { URL, Date, TextDecoder, Uint8Array, AbortController, setTimeout: timer, clearTimeout, console };
const payload = { teamId: 'team-fixture', advantageCredits: '2.125', maxAdvantageCredits: '50', userAdvantageCredits: '3.25', userMaxAdvantageCredits: '100', privateField: 'must-not-cross' };
const demo = { id: 'fixture', frameId: 0, url: 'http://localhost:3000/asistente', tab: { id: 5, url: 'http://localhost:3000/asistente' } };
const popup = { id: 'fixture', url: 'chrome-extension://fixture/popup.html' };

function background(options = {}) {
  let listener;
  let stored = options.stored ?? true;
  let getCount = 0;
  const calls = { query: [], send: [], set: [] };
  const chrome = {
    runtime: { id: 'fixture', getURL: (name) => `chrome-extension://fixture/${name}`, onMessage: { addListener: (value) => { listener = value; } } },
    storage: { local: {
      get: async () => options.get ? options.get(++getCount, stored) : { demoConnected: stored },
      set: async (value) => { calls.set.push(value); if (options.set) await options.set(value); stored = value.demoConnected; },
    } },
    tabs: {
      query: async (query) => { calls.query.push(query); return options.tabs ?? [{ id: 9, url: 'https://servicesessentials.ibm.com/settings/usage', active: true }]; },
      sendMessage: async (...args) => { calls.send.push(args); return options.send ? options.send(...args) : { ok: true, payload }; },
    },
  };
  const context = vm.createContext({ ...base, chrome });
  context.importScripts = () => vm.runInContext(sources.protocol, context);
  vm.runInContext(sources.background, context);
  return {
    calls,
    send(message, sender = demo) {
      return new Promise((resolve, reject) => {
        try { if (!listener(message, sender, (response) => resolve(clone(response)))) resolve(undefined); }
        catch (error) { reject(error); }
      });
    },
  };
}

function session(options = {}) {
  let listener;
  const calls = [];
  const window = {};
  window.top = options.iframe ? {} : window;
  const context = vm.createContext({
    ...base, window, location: { href: options.url ?? 'https://servicesessentials.ibm.com/settings/usage' },
    chrome: { runtime: { id: 'fixture', onMessage: { addListener: (value) => { listener = value; } } } },
    fetch: async (...args) => { calls.push(args); return options.fetch ? options.fetch(...args) : Response.json(payload); },
  });
  vm.runInContext(sources.protocol, context);
  vm.runInContext(sources['ibm-session'], context);
  return {
    calls,
    send(message = { type: 'IBM_SESSION_BUDGET', teamId: 'team-fixture' }, sender = { id: 'fixture' }) {
      return new Promise((resolve) => { if (!listener || !listener(message, sender, (response) => resolve(clone(response)))) resolve(undefined); });
    },
  };
}

function bridge(options = {}) {
  let listener;
  const requests = [];
  const posts = [];
  const callbacks = [];
  const window = {
    addEventListener: (_type, value) => { listener = value; },
    postMessage: (...args) => posts.push(clone(args)),
  };
  window.top = options.iframe ? {} : window;
  const context = vm.createContext({
    ...base, window, location: { origin: options.origin ?? 'http://localhost:3000' },
    chrome: { runtime: {
      lastError: undefined,
      sendMessage: (request, callback) => {
        requests.push(clone(request));
        callbacks.push(callback);
        if (!options.defer) callback({ ok: true, connected: false });
      },
    } },
  });
  vm.runInContext(sources.protocol, context);
  vm.runInContext(sources['demo-bridge'], context);
  return {
    requests, posts, callbacks,
    emit(overrides = {}) {
      listener?.({ source: window, origin: 'http://localhost:3000', data: {
        source: 'despacho-ibm-budget-client-v1', requestId: '1e9cbeef-a0a0-4444-bbbb-0123456789ab', type: 'BUDGET', teamId: 'team-fixture',
        ...overrides.data,
      }, ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'data')) });
    },
  };
}

test('manifest limita superficie a IBM, demo local y mundos aislados sin cookies API', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ['https://servicesessentials.ibm.com/*']);
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'storage']);
  assert.equal(manifest.externally_connectable, undefined);
  assert.ok(manifest.content_scripts.every((script) => script.all_frames === false && script.world !== 'MAIN'));
  assert.deepEqual(manifest.content_scripts[0].matches, ['http://localhost:3000/*']);
});

test('worker rechaza puerto, origen, frame, tab principal y extensión ajenos sin consultar IBM', async () => {
  const worker = background();
  const invalid = [
    { ...demo, id: 'other' }, { ...demo, frameId: 1 },
    { ...demo, url: 'http://localhost:3001/asistente' },
    { ...demo, url: 'https://localhost:3000/asistente' },
    { ...demo, url: 'http://localhost.evil:3000/asistente' },
    { ...demo, origin: 'https://unrelated.example.test' },
    { ...demo, tab: { id: 5, url: 'https://unrelated.example.test/' } },
  ];
  for (const sender of invalid) assert.equal(await worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' }, sender), undefined);
  assert.equal(worker.calls.query.length, 0);
});

test('detecta extensión desconectada sin sender.tab.url ni permiso activeTab previo', async () => {
  const worker = background({ stored: false });
  const noTabMetadata = { ...demo, origin: 'http://localhost:3000', tab: { id: 5 } };
  assert.deepEqual(await worker.send({ type: 'DEMO_STATUS' }, noTabMetadata), { ok: true, available: true, connected: false });
  assert.deepEqual(await worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' }, noTabMetadata), { ok: false, code: 'CONNECTOR_UNAVAILABLE' });
  assert.equal(worker.calls.query.length, 0);
});

test('consentimiento persistido funciona sin metadatos Tab sensibles tras reiniciar worker', async () => {
  const restarted = background({ stored: true });
  const noTabMetadata = { ...demo, origin: 'http://localhost:3000', tab: { id: 5 } };
  assert.equal((await restarted.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' }, noTabMetadata)).ok, true);
  assert.equal(restarted.calls.send.length, 1);
});

test('una página/content script no puede aprobar ni revocar su propio acceso', async () => {
  const worker = background({ stored: false });
  assert.equal(await worker.send({ type: 'CONNECT_DEMO' }), undefined);
  assert.equal(await worker.send({ type: 'DISCONNECT_DEMO' }), undefined);
  assert.equal(await worker.send({ type: 'CONNECT_DEMO' }, { ...popup, tab: demo.tab }), undefined);
  assert.equal(worker.calls.set.length, 0);
  assert.deepEqual(await worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' }), { ok: false, code: 'CONNECTOR_UNAVAILABLE' });
});

test('sólo popup aprueba y el worker filtra dos veces la respuesta al origen autorizado', async () => {
  const worker = background({ stored: false });
  assert.deepEqual(await worker.send({ type: 'CONNECT_DEMO' }, popup), { ok: true, available: true, connected: true });
  const response = await worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture', url: 'https://evil.invalid/', headers: { Cookie: 'forbidden' } });
  assert.equal(response.ok, true);
  assert.equal(response.payload.privateField, undefined);
  assert.equal(response.payload.userAdvantageCredits, '3.25');
  assert.deepEqual(clone(worker.calls.send[0][1]), { type: 'IBM_SESSION_BUDGET', teamId: 'team-fixture' });
  await worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' });
  assert.equal(worker.calls.send.length, 1, 'cache evita repetir la consulta en 30 segundos');
});

test('revocar bloquea respuestas que estaban en vuelo y descarta su caché', async () => {
  const upstream = deferred();
  const requested = deferred();
  const worker = background({ send: async () => { requested.resolve(); return upstream.promise; } });
  const reading = worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' });
  await requested.promise;
  await worker.send({ type: 'DISCONNECT_DEMO' }, popup);
  upstream.resolve({ ok: true, payload });
  assert.deepEqual(await reading, { ok: false, code: 'CONNECTOR_UNAVAILABLE' });
  await worker.send({ type: 'CONNECT_DEMO' }, popup);
  await worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' });
  assert.equal(worker.calls.send.length, 2);
});

test('revocar durante la lectura final del consentimiento no permite filtrar datos', async () => {
  const finalRead = deferred();
  const entered = deferred();
  const worker = background({ get: async (count) => { if (count === 2) { entered.resolve(); return finalRead.promise; } return { demoConnected: true }; } });
  const reading = worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' });
  await entered.promise;
  await worker.send({ type: 'DISCONNECT_DEMO' }, popup);
  finalRead.resolve({ demoConnected: true });
  assert.deepEqual(await reading, { ok: false, code: 'CONNECTOR_UNAVAILABLE' });
});

test('revocación bloquea inmediatamente mientras persiste y serializa escrituras concurrentes', async () => {
  const firstWrite = deferred();
  let writeCount = 0;
  const worker = background({ stored: false, set: async () => { if (++writeCount === 1) await firstWrite.promise; } });
  const connecting = worker.send({ type: 'CONNECT_DEMO' }, popup);
  const disconnecting = worker.send({ type: 'DISCONNECT_DEMO' }, popup);
  assert.equal((await worker.send({ type: 'DEMO_STATUS' })).connected, false);
  assert.deepEqual(await worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' }), { ok: false, code: 'CONNECTOR_UNAVAILABLE' });
  firstWrite.resolve();
  await Promise.all([connecting, disconnecting]);
  assert.deepEqual(clone(worker.calls.set), [{ demoConnected: true }, { demoConnected: false }]);
  assert.equal((await worker.send({ type: 'DEMO_STATUS' })).connected, false);
  assert.equal(worker.calls.query.length, 0);
});

test('tras iniciar W3 la actualización inmediata no reutiliza un error de sesión en caché', async () => {
  let attempts = 0;
  const worker = background({ send: async () => ++attempts === 1 ? { ok: false, code: 'SESSION_REQUIRED' } : { ok: true, payload } });
  assert.deepEqual(await worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' }), { ok: false, code: 'SESSION_REQUIRED' });
  assert.equal((await worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' })).ok, true);
  assert.equal(worker.calls.send.length, 2);
});

test('puente local valida source/origin/frame y no reenvía URLs, cookies o encabezados', () => {
  const local = bridge();
  local.emit({ source: {} });
  local.emit({ origin: 'http://localhost:3001' });
  local.emit({ data: { requestId: 'invalid-id' } });
  local.emit({ data: { type: 'CONNECT_DEMO' } });
  assert.equal(local.requests.length, 0);
  local.emit({ data: { url: 'https://evil.invalid/', headers: { Cookie: 'forbidden' } } });
  assert.deepEqual(local.requests, [{ type: 'DEMO_BUDGET', teamId: 'team-fixture' }]);
  assert.equal(local.posts[0][1], 'http://localhost:3000');
  const framed = bridge({ iframe: true });
  framed.emit();
  assert.equal(framed.requests.length, 0);
});

test('puente limita concurrencia y libera cupo al responder', () => {
  const local = bridge({ defer: true });
  for (let index = 0; index < 6; index++) local.emit();
  assert.equal(local.requests.length, 4);
  local.callbacks[0]({ ok: true });
  local.emit();
  assert.equal(local.requests.length, 5);
});

test('worker rechaza teams inválidos y nunca usa tabs IBM ajenos a Usage', async () => {
  const worker = background({ tabs: [{ id: 9, url: 'https://servicesessentials.ibm.com/settings/usage-evil' }] });
  for (const teamId of ['.', '..', 'team/other', 'team?query', '%2F', 'x'.repeat(129)]) {
    assert.equal((await worker.send({ type: 'DEMO_BUDGET', teamId })).ok, false);
  }
  assert.equal(worker.calls.query.length, 0);
  assert.deepEqual(await worker.send({ type: 'DEMO_BUDGET', teamId: 'team-fixture' }), { ok: false, code: 'SESSION_REQUIRED' });
  assert.equal(worker.calls.send.length, 0);
});

test('content IBM sólo se activa en origen Usage y frame superior', async () => {
  for (const options of [{ iframe: true }, { url: 'https://servicesessentials.ibm.com/settings/usage-evil' }, { url: 'https://other.example.test/settings/usage' }]) {
    const script = session(options);
    assert.equal(await script.send(), undefined);
    assert.equal(script.calls.length, 0);
  }
});

test('fetch IBM usa destino construido, sesión de mismo origen y sólo devuelve campos permitidos', async () => {
  const script = session();
  const response = await script.send({ type: 'IBM_SESSION_BUDGET', teamId: 'team-fixture', url: 'https://evil.invalid/' });
  assert.equal(response.ok, true);
  assert.equal(response.payload.privateField, undefined);
  assert.equal(script.calls[0][0], 'https://servicesessentials.ibm.com/services/integrations/team/team-fixture/budget');
  const init = script.calls[0][1];
  assert.equal(init.method, 'GET');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Cookie, undefined);
  assert.equal(init.headers.Authorization, undefined);
});

test('content IBM rechaza equipo inválido y remitente ajeno sin fetch', async () => {
  const script = session();
  assert.equal(await script.send({ type: 'IBM_SESSION_BUDGET', teamId: '..' }), undefined);
  assert.equal(await script.send(undefined, { id: 'another-extension' }), undefined);
  assert.equal(script.calls.length, 0);
});

test('401/403, HTML de login y redirección nunca devuelven presupuesto', async () => {
  for (const status of [401, 403]) {
    const script = session({ fetch: async () => new Response('private error', { status }) });
    assert.deepEqual(await script.send(), { ok: false, code: 'SESSION_REQUIRED' });
  }
  const html = session({ fetch: async () => new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }) });
  assert.deepEqual(await html.send(), { ok: false, code: 'SESSION_REQUIRED' });
  const redirected = Response.json(payload);
  Object.defineProperty(redirected, 'redirected', { value: true });
  const redirect = session({ fetch: async () => redirected });
  assert.deepEqual(await redirect.send(), { ok: false, code: 'REQUEST_FAILED' });
});

test('JSON inválido o respuesta de otro equipo no filtran datos', async () => {
  for (const body of ['{invalid', JSON.stringify({ ...payload, teamId: 'different-team' }), JSON.stringify({ teamId: 'team-fixture', userAdvantageCredits: -1 })]) {
    const script = session({ fetch: async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }) });
    assert.deepEqual(await script.send(), { ok: false, code: 'REQUEST_FAILED' });
  }
});

test('rechaza cuerpos grandes por header o tamaño transmitido y cancela su lector', async () => {
  const header = session({ fetch: async () => Response.json(payload, { headers: { 'Content-Length': '300000' } }) });
  assert.deepEqual(await header.send(), { ok: false, code: 'REQUEST_FAILED' });
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(262145)); }, cancel() { cancelled = true; } });
  const script = session({ fetch: async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }) });
  assert.deepEqual(await script.send(), { ok: false, code: 'REQUEST_FAILED' });
  assert.equal(cancelled, true);
});
