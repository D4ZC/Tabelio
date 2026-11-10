importScripts('protocol.js');

let approvalRevision = 0;
let approvalBlocked = false;
let approvalWrites = Promise.resolve();
const cache = new Map();
const inflight = new Map();
const errors = new Set(['SESSION_REQUIRED', 'REQUEST_FAILED', 'TIMEOUT']);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const internal = sender.id === chrome.runtime.id;
  const popup = internal && sender.url === chrome.runtime.getURL('popup.html') && !sender.tab;
  // sender.tab.url is permission-gated Tab metadata; sender.url/origin identify the
  // actual messaging document even before the popup has granted activeTab.
  const demo = internal && Number.isInteger(sender.tab?.id) && sender.frameId === 0
    && IbmBudgetProtocol.isDemoUrl(sender.url)
    && (sender.origin === undefined || sender.origin === IbmBudgetProtocol.demoOrigin)
    && (sender.tab.url === undefined || IbmBudgetProtocol.isDemoUrl(sender.tab.url));
  if (!message || !internal) return false;
  if (popup && ['POPUP_STATUS', 'CONNECT_DEMO', 'DISCONNECT_DEMO'].includes(message.type)) {
    popupRequest(message.type).then(sendResponse, () => sendResponse({ ok: false, code: 'REQUEST_FAILED' }));
    return true;
  }
  if (!demo || !['DEMO_STATUS', 'DEMO_BUDGET'].includes(message.type)) return false;
  demoRequest(message).then(sendResponse, () => sendResponse({ ok: false, code: 'REQUEST_FAILED' }));
  return true;
});

async function connected() {
  const revision = approvalRevision;
  if (approvalBlocked) return false;
  const stored = (await chrome.storage.local.get('demoConnected')).demoConnected === true;
  return stored && !approvalBlocked && revision === approvalRevision;
}

async function popupRequest(type) {
  if (type !== 'POPUP_STATUS') {
    // Only the extension popup can approve or revoke the local origin.
    const revision = ++approvalRevision;
    // Block immediately, including while storage I/O is pending or fails.
    approvalBlocked = true;
    cache.clear();
    inflight.clear();
    const write = approvalWrites.then(() => chrome.storage.local.set({ demoConnected: type === 'CONNECT_DEMO' }));
    approvalWrites = write.catch(() => {});
    await write;
    if (type === 'CONNECT_DEMO' && revision === approvalRevision) approvalBlocked = false;
  }
  return { ok: true, available: true, connected: await connected() };
}

async function demoRequest(message) {
  const revision = approvalRevision;
  const approved = await connected();
  if (message.type === 'DEMO_STATUS') return { ok: true, available: true, connected: approved };
  if (!approved || revision !== approvalRevision) return { ok: false, code: 'CONNECTOR_UNAVAILABLE' };
  if (!IbmBudgetProtocol.validTeam(message.teamId)) return { ok: false, code: 'REQUEST_FAILED' };
  const teamId = message.teamId;
  const previous = cache.get(teamId);
  let result;
  if (previous && Date.now() - previous.at < 30_000) result = previous.result;
  else {
    let pending = inflight.get(teamId);
    if (!pending) {
      pending = querySession(teamId).then((value) => {
        if (value.ok && revision === approvalRevision) {
          if (cache.size >= 16) cache.delete(cache.keys().next().value);
          cache.set(teamId, { at: Date.now(), result: value });
        }
        return value;
      }).finally(() => { if (inflight.get(teamId) === pending) inflight.delete(teamId); });
      inflight.set(teamId, pending);
    }
    result = await pending;
  }
  // Revocation also suppresses a response whose IBM request was already in flight.
  const stillConnected = await connected();
  if (!stillConnected || revision !== approvalRevision) return { ok: false, code: 'CONNECTOR_UNAVAILABLE' };
  return result;
}

async function querySession(teamId) {
  const tabs = await chrome.tabs.query({ url: `${IbmBudgetProtocol.usageUrl}*` });
  const tab = tabs.filter((value) => IbmBudgetProtocol.isUsageUrl(value.url))
    .sort((left, right) => Number(right.active) - Number(left.active))[0];
  if (!tab || !Number.isInteger(tab.id)) return { ok: false, code: 'SESSION_REQUIRED' };
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: 'IBM_SESSION_BUDGET', teamId }, { frameId: 0 }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), 6_000)),
    ]);
    if (!response?.ok) return { ok: false, code: errors.has(response?.code) ? response.code : 'REQUEST_FAILED' };
    return {
      ok: true, payload: IbmBudgetProtocol.budgetFields(response.payload, teamId),
      updatedAt: new Date().toISOString(),
    };
  } catch { return { ok: false, code: 'REQUEST_FAILED' }; }
}
