import { describe, expect, it } from 'vitest';
import { formatUsageMoney, usageAmountLabel, usageCostStatus, usageHasEstimate, type UsageTotal } from './ai-usage';

const total: UsageTotal = {
  amount: null, currency: null, confirmedAmount: null, estimatedAmount: null,
  pendingCount: 0, requestCount: 0, inputTokens: 0, outputTokens: 0,
};

describe('presentación de consumo IA', () => {
  it('no presenta costos desconocidos ni monedas ausentes como cero', () => {
    expect(formatUsageMoney(null, 'USD')).toBe('No disponible');
    expect(formatUsageMoney('0', null)).toBe('No disponible');
    expect(usageAmountLabel({ ...total, requestCount: 1 })).toBe('No disponible');
    expect(usageCostStatus({ ...total, requestCount: 1 })).toBe('Costo no disponible');
  });

  it('conserva visibles los costos pequeños y no los confunde con cero', () => {
    expect(formatUsageMoney('0.000031', 'USD')).toBe('0.000031 USD');
    expect(formatUsageMoney('0.00000001', 'USD')).toBe('<0.000001 USD');
    expect(formatUsageMoney('0.000000000000000000000000000001', 'USD')).toBe('<0.000001 USD');
    expect(formatUsageMoney('1e-8', 'USD')).toBe('<0.000001 USD');
    expect(formatUsageMoney('0e-8', 'USD')).toBe('0.00 USD');
    expect(formatUsageMoney('0', 'USD')).toBe('0.00 USD');
  });

  it('distingue ausencia de llamadas, consumo pendiente y un total parcial', () => {
    expect(usageAmountLabel(total)).toBe('Sin consumo');
    expect(usageAmountLabel({ ...total, amount: '0' })).toBe('Sin consumo');
    expect(usageAmountLabel({ ...total, requestCount: 1, pendingCount: 1 })).toBe('Pendiente');
    expect(usageCostStatus({ ...total, requestCount: 2, amount: '0.01', currency: 'USD', pendingCount: 1 }))
      .toBe('Parcial · 1 costo pendiente');
  });

  it('no promete un costo pendiente cuando el servidor confirma que falta la tarifa', () => {
    const unpriced = { ...total, requestCount: 2, pendingCount: 2 };
    const pricing = { status: 'unconfigured' as const, message: 'Falta una tarifa verificada del proveedor.' };
    expect(usageAmountLabel(unpriced, pricing)).toBe('Costo no disponible');
    expect(usageCostStatus(unpriced, pricing)).toBe('Tarifa sin configurar');
    expect(usageAmountLabel(total, pricing)).toBe('Sin consumo');
    expect(usageCostStatus(total, pricing)).toBe('Sin llamadas de IA');
  });

  it('conserva pendiente si la tarifa está configurada o su estado es desconocido', () => {
    const unpriced = { ...total, requestCount: 1, pendingCount: 1 };
    expect(usageAmountLabel(unpriced)).toBe('Pendiente');
    expect(usageAmountLabel(unpriced, { status: 'configured', message: '' })).toBe('Pendiente');
    expect(usageCostStatus(unpriced, { status: 'configured', message: '' })).toBe('1 costo pendiente');
  });

  it('no oculta un importe conocido aunque actualmente falte configuración de tarifa', () => {
    const priced = { ...total, requestCount: 1, amount: '0.15', currency: 'USD', confirmedAmount: '0.15' };
    const pricing = { status: 'unconfigured' as const, message: '' };
    expect(usageAmountLabel(priced, pricing)).toBe('0.15 USD');
    expect(usageCostStatus(priced, pricing)).toBe('Confirmado');
  });

  it('identifica una estimación y no la anuncia como costo confirmado', () => {
    const estimated = { ...total, requestCount: 1, amount: '0.01', currency: 'USD', estimatedAmount: '0.01' };
    expect(usageCostStatus(estimated)).toBe('Estimado');
    expect(usageCostStatus({ ...estimated, requestCount: 2, amount: '0.03', confirmedAmount: '0.02' }))
      .toBe('Incluye estimación');
    expect(usageCostStatus({ ...estimated, amount: '0', estimatedAmount: '0' })).toBe('Estimado');
  });

  it('identifica costos estimados de cero usando los conteos explícitos del servidor', () => {
    const zero = { ...total, requestCount: 1, amount: '0', currency: 'USD', confirmedAmount: '0', estimatedAmount: '0' };
    expect(usageCostStatus({ ...zero, estimatedCount: 1, confirmedCount: 0 })).toBe('Estimado');
    expect(usageHasEstimate({ ...zero, estimatedCount: 1, confirmedCount: 0 })).toBe(true);
    expect(usageCostStatus({ ...zero, estimatedCount: 0, confirmedCount: 1 })).toBe('Confirmado');
    expect(usageCostStatus({ ...zero, requestCount: 2, estimatedCount: 1, confirmedCount: 1 })).toBe('Incluye estimación');
  });

  it('mantiene la advertencia de estimación cuando parte del total aún no tiene costo', () => {
    const estimated = { ...total, requestCount: 2, pendingCount: 1, amount: '0.01', currency: 'USD', estimatedAmount: '0.01', estimatedCount: 1, confirmedCount: 0 };
    expect(usageCostStatus(estimated)).toBe('Estimado parcial · 1 costo pendiente');
    expect(usageAmountLabel(estimated)).toBe('0.01 USD');
  });
});
