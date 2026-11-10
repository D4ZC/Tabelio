import { Prisma } from '@despacho/database';
import type { UsageTotal } from './ai-usage.types';

export interface UsageGroup {
  state: string;
  currency: string | null;
  _count: number;
  _sum: {
    confirmedCost: Prisma.Decimal | null;
    estimatedCost: Prisma.Decimal | null;
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

// Only aggregate raw attempts, never both operations and their children.
export function aggregateUsage(groups: UsageGroup[]): UsageTotal {
  const currencies = new Set<string>();
  let confirmed = new Prisma.Decimal(0);
  let estimated = new Prisma.Decimal(0);
  let hasCost = false;
  let pendingCount = 0;
  let estimatedCount = 0;
  let confirmedCount = 0;
  let requestCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const group of groups) {
    requestCount += group._count;
    inputTokens += group._sum.inputTokens ?? 0;
    outputTokens += group._sum.outputTokens ?? 0;
    if (group.state !== 'CONFIRMED' && group.state !== 'ESTIMATED') pendingCount += group._count;
    if (group.state === 'ESTIMATED') estimatedCount += group._count;
    if (group.state === 'CONFIRMED') confirmedCount += group._count;
    if (group.currency && (group._sum.confirmedCost !== null || group._sum.estimatedCost !== null)) {
      currencies.add(group.currency);
      hasCost = true;
      confirmed = confirmed.plus(group._sum.confirmedCost ?? 0);
      estimated = estimated.plus(group._sum.estimatedCost ?? 0);
    }
  }
  const canSum = currencies.size <= 1 && (hasCost || requestCount === 0);
  return {
    amount: canSum ? confirmed.plus(estimated).toFixed() : null,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    confirmedAmount: canSum ? confirmed.toFixed() : null,
    estimatedAmount: canSum ? estimated.toFixed() : null,
    pendingCount, estimatedCount, confirmedCount, requestCount, inputTokens, outputTokens,
  };
}

export function readUsage(payload: unknown) {
  const body = record(payload);
  const usage = record(body.usage);
  const inputDetails = record(usage.input_tokens_details ?? usage.prompt_tokens_details);
  const outputDetails = record(usage.output_tokens_details ?? usage.completion_tokens_details);
  return {
    providerResponseId: safeIdentifier(body.id),
    model: safeIdentifier(body.model),
    inputTokens: tokenCount(usage.input_tokens ?? usage.prompt_tokens),
    outputTokens: tokenCount(usage.output_tokens ?? usage.completion_tokens),
    cachedInputTokens: tokenCount(inputDetails.cached_tokens),
    reasoningTokens: tokenCount(outputDetails.reasoning_tokens),
  };
}

export function safeIdentifier(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 160
    && !/[\r\n\u0000]/.test(value) ? value : null;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647
    ? value : null;
}
