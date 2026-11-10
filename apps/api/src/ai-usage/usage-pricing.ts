import { Prisma } from '@despacho/database';

export interface PricingUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
}

export interface ModelTariff {
  model: string;
  version: string;
  currency: string;
  inputPerMillion: string;
  outputPerMillion: string;
  cachedInputPerMillion?: string;
  sourceUrl: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  longContext?: {
    inputThresholdTokens: number;
    inputPerMillion: string;
    outputPerMillion: string;
    cachedInputPerMillion?: string;
  };
}

export interface TariffEstimate {
  amount: string;
  currency: string;
  source: string;
  estimated: true;
  snapshot: Prisma.InputJsonObject;
}

export function validCostCurrency(value: unknown): value is string {
  return typeof value === 'string' && (/^[A-Z]{3}$/.test(value) || value === 'Advantage Credits');
}

/** There is no built-in price, alias fallback, or conversion from another provider's retail price. */
export function configuredModelTariff(
  raw: unknown, model: string, at: Date, requireEffectiveFrom = false,
): ModelTariff | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 65_536 || !Number.isFinite(at.getTime())) return null;
  try {
    const config = object(JSON.parse(raw));
    if (!Object.hasOwn(config, model)) return null;
    const entry = object(config[model]);
    if (typeof entry.version !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(entry.version)
      || !validCostCurrency(entry.currency)) return null;
    const input = rate(entry.inputPerMillion);
    const output = rate(entry.outputPerMillion);
    const cached = entry.cachedInputPerMillion === undefined ? undefined : rate(entry.cachedInputPerMillion);
    if (input === null || output === null || cached === null) return null;
    let longContext: ModelTariff['longContext'];
    if (entry.longContext !== undefined) {
      const context = object(entry.longContext);
      const contextInput = rate(context.inputPerMillion);
      const contextOutput = rate(context.outputPerMillion);
      const contextCached = context.cachedInputPerMillion === undefined ? undefined : rate(context.cachedInputPerMillion);
      if (!tokens(context.inputThresholdTokens) || context.inputThresholdTokens === 0
        || contextInput === null || contextOutput === null || contextCached === null) return null;
      longContext = {
        inputThresholdTokens: context.inputThresholdTokens, inputPerMillion: contextInput, outputPerMillion: contextOutput,
        ...(contextCached === undefined ? {} : { cachedInputPerMillion: contextCached }),
      };
    }
    if (typeof entry.sourceUrl !== 'string' || entry.sourceUrl.length > 1000) return null;
    const source = new URL(entry.sourceUrl);
    if (source.protocol !== 'https:' || source.username || source.password) return null;
    const from = entry.effectiveFrom === undefined ? undefined : isoTime(entry.effectiveFrom);
    const to = entry.effectiveTo === undefined ? undefined : isoTime(entry.effectiveTo);
    if (from === null || to === null || requireEffectiveFrom && !from
      || from && at.getTime() < Date.parse(from) || to && at.getTime() >= Date.parse(to)
      || from && to && Date.parse(from) >= Date.parse(to)) return null;
    return {
      model, version: entry.version, currency: entry.currency,
      inputPerMillion: input, outputPerMillion: output,
      ...(cached !== undefined ? { cachedInputPerMillion: cached } : {}),
      sourceUrl: source.toString(), ...(from ? { effectiveFrom: from } : {}), ...(to ? { effectiveTo: to } : {}),
      ...(longContext ? { longContext } : {}),
    };
  } catch { return null; }
}

export function estimateWithTariff(tariff: ModelTariff, usage: PricingUsage): TariffEstimate | null {
  const { inputTokens, outputTokens, reasoningTokens } = usage;
  if (!tokens(inputTokens) || !tokens(outputTokens)
    || reasoningTokens !== null && (!tokens(reasoningTokens) || reasoningTokens > outputTokens)) return null;
  let cached = usage.cachedInputTokens;
  const rates = tariff.longContext && inputTokens > tariff.longContext.inputThresholdTokens ? tariff.longContext : tariff;
  const inputRate = new Prisma.Decimal(rates.inputPerMillion);
  const cachedRate = rates.cachedInputPerMillion === undefined ? null : new Prisma.Decimal(rates.cachedInputPerMillion);
  // Missing cache details are safe only when they cannot affect the amount.
  if (cached === null && (inputTokens === 0 || cachedRate?.equals(inputRate))) cached = 0;
  if (!tokens(cached) || cached > inputTokens || cached > 0 && cachedRate === null) return null;
  const unrounded = inputRate.mul(inputTokens - cached)
    .plus(cachedRate?.mul(cached) ?? 0)
    .plus(new Prisma.Decimal(rates.outputPerMillion).mul(outputTokens))
    .div(1_000_000);
  const amount = unrounded.toDecimalPlaces(12);
  if (unrounded.gt(0) && amount.isZero()) return null;
  if (!amount.isFinite() || amount.isNegative() || amount.gte('1000000000000')) return null;
  return {
    amount: amount.toFixed(), currency: tariff.currency, source: `tariff:${tariff.version}`, estimated: true,
    snapshot: JSON.parse(JSON.stringify({
      ...tariff, calculationVersion: 1, tokensPerUnit: 1_000_000,
      appliedRates: {
        context: rates === tariff ? 'standard' : 'long', inputPerMillion: rates.inputPerMillion,
        outputPerMillion: rates.outputPerMillion,
        ...(rates.cachedInputPerMillion === undefined ? {} : { cachedInputPerMillion: rates.cachedInputPerMillion }),
      },
      inputTokens, outputTokens, cachedInputTokens: usage.cachedInputTokens,
      reasoningTokens, reasoningIncludedInOutput: true,
    })) as Prisma.InputJsonObject,
  };
}

function tokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
}

function rate(value: unknown): string | null {
  // Configuration uses decimal strings to avoid losing precision through JSON numbers.
  if (typeof value !== 'string' || value.length > 80 || !/^\d+(?:\.\d+)?(?:e[+-]?\d{1,3})?$/i.test(value)) return null;
  const decimal = new Prisma.Decimal(value);
  return decimal.isFinite() && !decimal.isNegative() && decimal.lt('1000000000000') ? decimal.toFixed() : null;
}

function isoTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return date.toISOString();
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
