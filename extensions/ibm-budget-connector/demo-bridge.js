(() => {
  if (window.top !== window || location.origin !== IbmBudgetProtocol.demoOrigin) return;
  let pending = 0;
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== window || event.origin !== IbmBudgetProtocol.demoOrigin
      || !message || message.source !== IbmBudgetProtocol.clientSource
      || typeof message.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(message.requestId)
      || !['STATUS', 'BUDGET'].includes(message.type) || pending >= 4) return;
    if (message.type === 'BUDGET' && !IbmBudgetProtocol.validTeam(message.teamId)) return;
    pending += 1;
    // No methods, URLs or headers from the webpage can reach IBM.
    const request = message.type === 'STATUS' ? { type: 'DEMO_STATUS' } : { type: 'DEMO_BUDGET', teamId: message.teamId };
    chrome.runtime.sendMessage(request, (response) => {
      pending -= 1;
      const error = chrome.runtime.lastError;
      window.postMessage({
        source: IbmBudgetProtocol.connectorSource, requestId: message.requestId,
        response: error || !response ? { ok: false, code: 'CONNECTOR_UNAVAILABLE' } : response,
      }, IbmBudgetProtocol.demoOrigin);
    });
  });
})();
