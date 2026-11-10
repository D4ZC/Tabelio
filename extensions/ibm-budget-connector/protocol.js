/* Shared only inside the extension's isolated worlds and service worker. */
const IbmBudgetProtocol = Object.freeze({
  demoOrigin: 'http://localhost:3000',
  ibmOrigin: 'https://servicesessentials.ibm.com',
  usageUrl: 'https://servicesessentials.ibm.com/settings/usage',
  clientSource: 'despacho-ibm-budget-client-v1',
  connectorSource: 'despacho-ibm-budget-connector-v1',
  validTeam(teamId) {
    return typeof teamId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(teamId) && teamId !== '.' && teamId !== '..';
  },
  isDemoUrl(value) {
    try { return new URL(value).origin === this.demoOrigin; } catch { return false; }
  },
  isUsageUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === this.ibmOrigin && ['/settings/usage', '/settings/usage/'].includes(url.pathname);
    } catch { return false; }
  },
  budgetUrl(teamId) {
    if (!this.validTeam(teamId)) throw new Error('INVALID_REQUEST');
    return `${this.ibmOrigin}/services/integrations/team/${encodeURIComponent(teamId)}/budget`;
  },
  // Never pass through cookies, account identifiers, free-form errors or extra response fields.
  budgetFields(body, teamId) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.teamId !== teamId) throw new Error('INVALID_RESPONSE');
    const result = { teamId };
    if (typeof body.teamAlias === 'string' && body.teamAlias.length <= 160) result.teamAlias = body.teamAlias;
    const amountKeys = ['advantageCredits', 'maxAdvantageCredits', 'userAdvantageCredits', 'userMaxAdvantageCredits'];
    for (const key of amountKeys) {
      const value = body[key];
      if (value === null && key.startsWith('max') || value === null && key === 'userMaxAdvantageCredits') {
        result[key] = null;
      } else if ((typeof value === 'number' && Number.isFinite(value) || typeof value === 'string')
        && String(value).length <= 128 && /^\d+(?:\.\d+)?(?:[eE][+-]?\d{1,2})?$/.test(String(value))) {
        result[key] = String(value);
      }
    }
    const hasTeam = result.advantageCredits !== undefined && result.maxAdvantageCredits !== undefined;
    const hasIndividual = result.userAdvantageCredits !== undefined && result.userMaxAdvantageCredits !== undefined;
    if (!hasTeam && !hasIndividual) throw new Error('INVALID_RESPONSE');
    const reset = Number(body.budgetResetAtEpochSeconds);
    if (Number.isSafeInteger(reset) && reset >= 946684800 && reset <= 7258118400) result.budgetResetAtEpochSeconds = reset;
    return result;
  },
});
