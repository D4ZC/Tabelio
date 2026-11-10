(() => {
  if (window.top !== window || !IbmBudgetProtocol.isUsageUrl(location.href)) return;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'IBM_SESSION_BUDGET'
      || !IbmBudgetProtocol.validTeam(message.teamId)) return false;
    readBudget(message.teamId).then(sendResponse, () => sendResponse({ ok: false, code: 'REQUEST_FAILED' }));
    return true;
  });

  async function readBudget(teamId) {
    // Fetch runs at IBM's origin. Chrome supplies the existing W3 session; code never reads it.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      if (!IbmBudgetProtocol.isUsageUrl(location.href)) return { ok: false, code: 'SESSION_REQUIRED' };
      const response = await fetch(IbmBudgetProtocol.budgetUrl(teamId), {
        method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return { ok: false, code: 'SESSION_REQUIRED' };
      if (!response.ok || response.redirected) return { ok: false, code: 'REQUEST_FAILED' };
      if (!/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
        return { ok: false, code: 'SESSION_REQUIRED' };
      }
      if (Number(response.headers.get('content-length')) > 262144 || !response.body) throw new Error('INVALID_RESPONSE');
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 262144) { await reader.cancel(); throw new Error('INVALID_RESPONSE'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const payload = IbmBudgetProtocol.budgetFields(JSON.parse(new TextDecoder().decode(bytes)), teamId);
      return { ok: true, payload, updatedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, code: error?.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED' };
    } finally { clearTimeout(timeout); controller.abort(); }
  }
})();
