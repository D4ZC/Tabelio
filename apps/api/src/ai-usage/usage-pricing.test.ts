import { describe, expect, it } from 'vitest';
import { configuredModelTariff, estimateWithTariff } from './usage-pricing';

// Synthetic rates exercise the calculation; they are not prices offered by IBM.
const entry = {
  version: 'synthetic-test-v1', currency: 'Advantage Credits',
  inputPerMillion: '2', outputPerMillion: '8', cachedInputPerMillion: '0.2',
  sourceUrl: 'https://pricing.example.test/fixture',
};
const date = new Date('2026-11-02T12:00:00Z');
const tariff = (overrides: Record<string, unknown> = {}) => configuredModelTariff(
  JSON.stringify({ 'test-model': { ...entry, ...overrides } }), 'test-model', date,
)!;

describe('estimación por tarifas explícitas', () => {
  it('valora chat y extracción con tarifa sintética y guarda snapshot auditable', () => {
    const chat = estimateWithTariff(tariff(), { inputTokens: 2333, outputTokens: 161, cachedInputTokens: 0, reasoningTokens: 0 });
    const extraction = estimateWithTariff(tariff(), { inputTokens: 715, outputTokens: 397, cachedInputTokens: 0, reasoningTokens: 255 });
    expect(chat?.amount).toBe('0.005954');
    expect(extraction?.amount).toBe('0.004606');
    expect(extraction).toMatchObject({ estimated: true, currency: 'Advantage Credits', source: 'tariff:synthetic-test-v1' });
    expect(extraction?.snapshot).toMatchObject({
      model: 'test-model', version: 'synthetic-test-v1', inputPerMillion: '2', outputPerMillion: '8',
      sourceUrl: entry.sourceUrl, outputTokens: 397, reasoningTokens: 255, reasoningIncludedInOutput: true,
    });
  });

  it('descuenta tokens de caché de entrada y no vuelve a sumar razonamiento a salida', () => {
    expect(estimateWithTariff(tariff(), {
      inputTokens: 1000, cachedInputTokens: 200, outputTokens: 100, reasoningTokens: 50,
    })?.amount).toBe('0.00244');
  });

  it('mantiene pendientes los tokens faltantes o inconsistentes que afectan el importe', () => {
    const sample = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, reasoningTokens: null };
    for (const change of [
      { inputTokens: null }, { outputTokens: null }, { cachedInputTokens: null },
      { cachedInputTokens: 1001 }, { reasoningTokens: 101 }, { inputTokens: -1 },
    ]) expect(estimateWithTariff(tariff(), { ...sample, ...change })).toBeNull();
    expect(estimateWithTariff(tariff({ cachedInputPerMillion: undefined }), { ...sample, cachedInputTokens: 1 })).toBeNull();
    expect(estimateWithTariff(tariff({ cachedInputPerMillion: undefined }), sample)?.amount).toBe('0.0028');
  });

  it('tolera caché desconocida sólo cuando su tarifa es igual y no afecta la suma', () => {
    expect(estimateWithTariff(tariff({ cachedInputPerMillion: '2' }), {
      inputTokens: 1000, cachedInputTokens: null, outputTokens: 100, reasoningTokens: null,
    })?.amount).toBe('0.0028');
  });

  it('no transforma importes positivos menores que la precisión persistida en consumo gratuito', () => {
    const usage = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
    expect(estimateWithTariff(tariff({ inputPerMillion: '1e-100' }), usage)).toBeNull();
    expect(estimateWithTariff(tariff({ inputPerMillion: '0', outputPerMillion: '0' }), usage)?.amount).toBe('0');
  });

  it('aplica tarifa de contexto largo sólo por encima del umbral y guarda las tasas elegidas', () => {
    const context = tariff({ longContext: {
      inputThresholdTokens: 100, inputPerMillion: '4', outputPerMillion: '15', cachedInputPerMillion: '0.2',
    } });
    expect(estimateWithTariff(context, { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, reasoningTokens: 0 })?.amount).toBe('0.00028');
    const long = estimateWithTariff(context, { inputTokens: 101, outputTokens: 10, cachedInputTokens: 10, reasoningTokens: 0 });
    expect(long?.amount).toBe('0.000516');
    expect(long?.snapshot.appliedRates).toMatchObject({ context: 'long', inputPerMillion: '4', outputPerMillion: '15' });
    expect(tariff({ longContext: { inputThresholdTokens: 0 } })).toBeNull();
  });

  it('sólo permite el modelo exacto y las fechas cubiertas por la tarifa', () => {
    const config = JSON.stringify({ 'test-model': { ...entry, effectiveFrom: '2026-11-02', effectiveTo: '2026-11-03' } });
    expect(configuredModelTariff(config, 'test-model', date)).not.toBeNull();
    expect(configuredModelTariff(config, 'test-model-alias', date)).toBeNull();
    expect(configuredModelTariff(config, 'test-model', new Date('2026-11-01T23:59:59Z'))).toBeNull();
    expect(configuredModelTariff(config, 'test-model', new Date('2026-11-03T00:00:00Z'))).toBeNull();
  });

  it('no valora históricos si la fecha inicial no fue documentada', () => {
    expect(configuredModelTariff(JSON.stringify({ 'test-model': entry }), 'test-model', date, true)).toBeNull();
    expect(configuredModelTariff(JSON.stringify({ 'test-model': { ...entry, effectiveFrom: '2026-11-01' } }), 'test-model', date, true)).not.toBeNull();
  });

  it('rechaza configuración incompleta, números JSON imprecisos y fuentes sin HTTPS', () => {
    for (const invalid of [
      { version: '' }, { inputPerMillion: 2 }, { inputPerMillion: '-1' },
      { outputPerMillion: 'NaN' }, { cachedInputPerMillion: 'not-a-number' },
      { currency: 'invented-unit' }, { sourceUrl: 'http://pricing.example.test' },
      { sourceUrl: 'https://user:password@pricing.example.test' },
      { effectiveFrom: '2026-02-31' }, { effectiveFrom: '2026-11-03', effectiveTo: '2026-11-02' },
    ]) expect(tariff(invalid)).toBeNull();
    expect(configuredModelTariff('{broken', 'test-model', date)).toBeNull();
    expect(configuredModelTariff(undefined, 'test-model', date)).toBeNull();
  });
});
