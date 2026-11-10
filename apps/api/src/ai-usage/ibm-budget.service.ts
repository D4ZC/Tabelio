import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@despacho/database';
import { createHash } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { unavailableBudget, type AiBudgetProvider, type BudgetView } from './ai-usage.types';
import { record } from './usage-totals';

interface BudgetFields {
  url: string;
  scope: 'individual' | 'shared';
  owner: string;
  currency: string;
  currencyPath: string;
  limitPath: string;
  spentPath: string;
  remainingPath: string;
}

interface BudgetConfig extends BudgetFields {
  mode: 'api_key';
  apiKey: string;
  header: string;
  scheme: string;
  hash: string;
}

interface W3BudgetConfig extends BudgetFields {
  mode: 'w3';
  teamId: string;
}

/** Read-only adapter: routes and field mappings must come from a verified IBM contract. */
@Injectable()
export class IbmBudgetService implements AiBudgetProvider {
  private readonly inflight = new Map<string, Promise<BudgetView>>();
  private readonly retryAfter = new Map<string, number>();

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async getBudget(user: AuthenticatedUser): Promise<BudgetView> {
    const settings = this.settings(user);
    if (!settings) return unavailableBudget();
    if (settings.mode === 'w3') {
      // W3 cookies remain in the browser. This route does not accept the inference API key.
      return {
        ...unavailableBudget(), scope: 'shared',
        message: 'Conecta tu sesión W3 de IBM para consultar tu presupuesto y el consumo del equipo.',
        connection: {
          mode: 'w3', teamId: settings.teamId, url: settings.url,
          loginUrl: 'https://servicesessentials.ibm.com/settings/usage',
          limitPath: settings.limitPath, spentPath: settings.spentPath,
          remainingPath: settings.remainingPath, currency: settings.currency, currencyPath: settings.currencyPath,
        },
      };
    }
    const id = createHash('sha256').update(`${user.organizationId}:${user.userId}:${settings.hash}`).digest('hex');
    const active = this.inflight.get(id);
    if (active) return active;
    const read = this.readBudget(user, id, settings);
    this.inflight.set(id, read);
    try { return await read; }
    finally { this.inflight.delete(id); }
  }

  private async readBudget(user: AuthenticatedUser, id: string, settings: BudgetConfig): Promise<BudgetView> {
    const previous = await this.prisma.aiBudgetSnapshot.findFirst({
      where: { id, organizationId: user.organizationId, userId: user.userId, providerConfigHash: settings.hash },
    });
    if (previous && Date.now() - previous.updatedAt.getTime() < this.cacheMs()) return this.view(previous);
    if ((this.retryAfter.get(id) ?? 0) > Date.now()) return previous ? this.view(previous, true) : unavailableBudget();
    // Failed requests also back off, so polling the UI never hammers IBM.
    this.retryAfter.set(id, Date.now() + this.cacheMs());
    if (this.retryAfter.size > 1000) {
      for (const [key, time] of this.retryAfter) if (time < Date.now()) this.retryAfter.delete(key);
      if (this.retryAfter.size > 1000) this.retryAfter.delete(this.retryAfter.keys().next().value!);
    }
    try {
      const response = await fetch(settings.url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5_000),
        headers: {
          Accept: 'application/json',
          [settings.header]: settings.scheme ? `${settings.scheme} ${settings.apiKey}` : settings.apiKey,
        },
      });
      if (!response.ok) throw new Error('budget unavailable');
      const contentLength = Number(response.headers.get('content-length'));
      if (contentLength > 1_048_576) throw new Error('budget too large');
      const text = await response.text();
      if (Buffer.byteLength(text) > 1_048_576) throw new Error('budget too large');
      const body: unknown = JSON.parse(text);
      const currency = settings.currency || String(readField(body, settings.currencyPath) ?? '');
      if (!/^[A-Z][A-Z0-9_]{2,15}$/.test(currency)) throw new Error('unverified budget currency');
      const limit = amountAt(body, settings.limitPath);
      const spent = amountAt(body, settings.spentPath);
      const suppliedRemaining = amountAt(body, settings.remainingPath, true);
      const remaining = suppliedRemaining ?? (limit !== null && spent !== null ? limit.minus(spent) : null);
      if (limit === null && spent === null && remaining === null) throw new Error('no budget fields');
      const snapshot = {
        organizationId: user.organizationId, userId: user.userId, providerConfigHash: settings.hash,
        scope: settings.scope, currency, limit, spent, remaining, updatedAt: new Date(),
      };
      await this.prisma.aiBudgetSnapshot.upsert({ where: { id }, create: { id, ...snapshot }, update: snapshot });
      return this.view(snapshot);
    } catch {
      // Keep errors, URLs, keys and upstream response bodies out of the browser.
      return previous ? this.view(previous, true) : unavailableBudget();
    }
  }

  private view(snapshot: {
    scope: string; currency: string | null; limit: Prisma.Decimal | null; spent: Prisma.Decimal | null;
    remaining: Prisma.Decimal | null; updatedAt: Date;
  }, stale = false): BudgetView {
    return {
      status: stale ? 'stale' : 'available', scope: snapshot.scope === 'individual' ? 'individual' : 'shared',
      currency: snapshot.currency, limit: snapshot.limit?.toFixed() ?? null,
      spent: snapshot.spent?.toFixed() ?? null, remaining: snapshot.remaining?.toFixed() ?? null,
      updatedAt: snapshot.updatedAt.toISOString(),
      message: stale ? 'IBM no pudo actualizar el presupuesto. Se muestra el último saldo conocido.'
        : snapshot.scope === 'shared' ? 'Saldo de la cuenta compartida de IBM.' : 'Presupuesto individual informado por IBM.',
    };
  }

  private settings(user: AuthenticatedUser): BudgetConfig | W3BudgetConfig | null {
    const teamId = this.config.get<string>('ICA_BUDGET_TEAM_ID')?.trim();
    if (teamId && (teamId === '.' || teamId === '..' || !/^[A-Za-z0-9._-]{1,128}$/.test(teamId))) return null;
    const url = this.config.get<string>('ICA_BUDGET_URL')?.trim()
      || (teamId ? `https://servicesessentials.ibm.com/services/integrations/team/${encodeURIComponent(teamId)}/budget` : undefined);
    let parsed: URL | undefined;
    try { if (url) parsed = new URL(url); } catch { return null; }
    const owner = this.config.get<string>('ICA_BUDGET_OWNER_EMAIL')?.trim().toLowerCase();
    const teamMatch = parsed?.pathname.match(/^\/services\/integrations\/team\/([^/]+)\/budget\/?$/);
    const teamEndpoint = Boolean(teamMatch);
    const scope = this.config.get<string>('ICA_BUDGET_SCOPE') || (teamEndpoint ? 'shared' : undefined);
    const mode = this.config.get<string>('ICA_BUDGET_AUTH_MODE') || (teamEndpoint ? 'w3' : undefined);
    // A shared server key is never automatically the personal budget of every local user.
    if (!url || !owner || owner !== user.email.toLowerCase()
      || (scope !== 'individual' && scope !== 'shared') || (teamEndpoint && scope !== 'shared')) return null;
    if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash
      || !['api.servicesessentials.ibm.com', 'servicesessentials.ibm.com'].includes(parsed.hostname)) return null;
    const fields = {
      url, scope, owner,
      currency: this.config.get('ICA_BUDGET_CURRENCY', '').trim(),
      currencyPath: this.config.get('ICA_BUDGET_CURRENCY_PATH', '').trim(),
      limitPath: this.config.get('ICA_BUDGET_LIMIT_PATH', '').trim(),
      spentPath: this.config.get('ICA_BUDGET_SPENT_PATH', '').trim(),
      remainingPath: this.config.get('ICA_BUDGET_REMAINING_PATH', '').trim(),
    };
    if (mode === 'w3') {
      // Only expose the verified team endpoint; query strings may contain private credentials.
      if (!teamMatch || parsed.search) return null;
      let endpointTeamId: string;
      try { endpointTeamId = decodeURIComponent(teamMatch[1]); } catch { return null; }
      if (endpointTeamId === '.' || endpointTeamId === '..' || !/^[A-Za-z0-9._-]{1,128}$/.test(endpointTeamId)) return null;
      return { ...fields, scope: 'shared', mode: 'w3', teamId: endpointTeamId };
    }
    // API-key authentication is opt-in for a separately verified generic endpoint.
    if (mode !== 'api_key' || teamEndpoint) return null;
    const apiKey = this.config.get<string>('ICA_BUDGET_API_KEY') || this.config.get<string>('ASSISTANT_API_KEY');
    const header = this.config.get('ASSISTANT_API_KEY_HEADER', 'Authorization').trim();
    const scheme = this.config.get('ASSISTANT_API_KEY_SCHEME', 'Bearer').trim();
    if (!apiKey || !/^[A-Za-z0-9-]+$/.test(header) || /[\r\n]/.test(scheme)) return null;
    if (!fields.limitPath && !fields.spentPath && !fields.remainingPath) return null;
    // A changed credential/contract must not reuse another account's cached snapshot.
    const hash = createHash('sha256').update(JSON.stringify({ ...fields, mode, header, scheme })).update(apiKey).digest('hex');
    return { ...fields, mode: 'api_key', scope, apiKey, header, scheme, hash };
  }

  private cacheMs() {
    const seconds = Number(this.config.get('ICA_BUDGET_CACHE_SECONDS', '60'));
    return Number.isFinite(seconds) ? Math.max(30, Math.min(seconds, 3600)) * 1000 : 60_000;
  }
}

function readField(value: unknown, path: string): unknown {
  if (!path || path.length > 200) return undefined;
  return path.split('.').reduce<unknown>((current, key) => (
    Object.hasOwn(record(current), key) ? record(current)[key] : undefined
  ), value);
}

function amountAt(value: unknown, path: string, negative = false): Prisma.Decimal | null {
  const raw = readField(value, path);
  if (raw === null || raw === undefined) return null;
  if ((typeof raw !== 'string' && typeof raw !== 'number')
    || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d{1,3})?$/i.test(String(raw))) throw new Error('invalid budget amount');
  const amount = new Prisma.Decimal(raw);
  if (!amount.isFinite() || (!negative && amount.isNegative()) || amount.abs().gte('1000000000000')) {
    throw new Error('invalid budget amount');
  }
  return amount.toDecimalPlaces(12);
}
