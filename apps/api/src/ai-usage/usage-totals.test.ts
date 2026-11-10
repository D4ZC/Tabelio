import { Prisma } from '@despacho/database';
import { describe, expect, it } from 'vitest';
import { aggregateUsage, readUsage, type UsageGroup } from './usage-totals';

function group(cost: string | null, currency: string | null, state = 'CONFIRMED', count = 1): UsageGroup {
  return {
    state, currency, _count: count,
    _sum: {
      confirmedCost: cost === null || state === 'ESTIMATED' ? null : new Prisma.Decimal(cost),
      estimatedCost: cost !== null && state === 'ESTIMATED' ? new Prisma.Decimal(cost) : null,
      inputTokens: 100 * count, outputTokens: 20 * count,
    },
  };
}

describe('agregación de consumo de IA', () => {
  it('conserva fracciones pequeñas y suma cada intento, incluso reintentos y pendientes', () => {
    const total = aggregateUsage([
      group('0.000000000001', 'USD'),
      group('0.000000000002', 'USD', 'ESTIMATED'),
      group(null, null, 'PENDING', 2),
    ]);
    expect(total).toEqual({
      amount: '0.000000000003', currency: 'USD', confirmedAmount: '0.000000000001',
      estimatedAmount: '0.000000000002', pendingCount: 2, estimatedCount: 1, confirmedCount: 1, requestCount: 4,
      inputTokens: 400, outputTokens: 80,
    });
  });

  it('no convierte un costo desconocido en cero', () => {
    expect(aggregateUsage([group(null, null, 'PENDING')])).toMatchObject({ amount: null, pendingCount: 1 });
    expect(aggregateUsage([])).toMatchObject({ amount: '0', requestCount: 0, pendingCount: 0 });
  });

  it('no suma divisas diferentes ni pierde tokens por ese motivo', () => {
    expect(aggregateUsage([group('1', 'USD'), group('2', 'MXN')])).toMatchObject({
      amount: null, currency: null, confirmedAmount: null, inputTokens: 200,
    });
  });

  it('separa tokens de caché y razonamiento que ya están incluidos en los totales', () => {
    expect(readUsage({
      id: 'res-test', model: 'actual-model',
      usage: {
        input_tokens: 100, output_tokens: 50,
        input_tokens_details: { cached_tokens: 80 },
        output_tokens_details: { reasoning_tokens: 30 },
      },
    })).toEqual({
      providerResponseId: 'res-test', model: 'actual-model', inputTokens: 100,
      outputTokens: 50, cachedInputTokens: 80, reasoningTokens: 30,
    });
    expect(readUsage({ usage: { input_tokens: -1, output_tokens: 0.5 } })).toMatchObject({
      inputTokens: null, outputTokens: null,
    });
  });
});
