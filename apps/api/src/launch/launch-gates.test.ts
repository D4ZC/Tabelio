import { describe, expect, it } from 'vitest';
import { evaluateLaunchGates } from './launch-gates';

const readyInput = {
  environmentBlockers: 0,
  requiredUatCategories: 5,
  coveredUatCategories: 5,
  totalUatCases: 5,
  pendingUatCases: 0,
  failedUatCases: 0,
  requiredIntegrations: 5,
  acceptedIntegrations: 5,
  requiredComplianceControls: 6,
  completedComplianceControls: 6,
  hasMetricSnapshot: true,
  metricBlockers: 0,
};

describe('evaluateLaunchGates', () => {
  it('aprueba únicamente cuando todas las compuertas están completas', () => {
    expect(evaluateLaunchGates(readyInput)).toMatchObject({ ready: true, blockers: 0 });
  });

  it('bloquea UAT incompleta o fallida', () => {
    const result = evaluateLaunchGates({ ...readyInput, coveredUatCategories: 4, failedUatCases: 1 });
    expect(result.ready).toBe(false);
    expect(result.checks.find((item) => item.code === 'UAT_ACCEPTED')?.status).toBe('BLOCKED');
  });

  it('bloquea adaptadores no aceptados', () => {
    expect(evaluateLaunchGates({ ...readyInput, acceptedIntegrations: 4 }).blockers).toBe(1);
  });

  it('bloquea si no existe una fotografía de métricas', () => {
    expect(evaluateLaunchGates({ ...readyInput, hasMetricSnapshot: false }).ready).toBe(false);
  });
});
