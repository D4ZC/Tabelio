import { describe, expect, it } from 'vitest';
import { evaluateReadiness } from './readiness';

describe('semáforo operativo del expediente', () => {
  it('marca rojo cuando existe cualquier requisito bloqueante', () => {
    const result = evaluateReadiness({
      blockingPending: 2, nonBlockingPending: 1, highWarnings: 1, mediumWarnings: 0,
    });
    expect(result).toMatchObject({ level: 'BLOCKED', canAdvance: false });
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: 'BLOCKING_REQUIREMENTS', count: 2,
    }));
  });

  it('marca amarillo para advertencias o recomendaciones no bloqueantes', () => {
    expect(evaluateReadiness({
      blockingPending: 0, nonBlockingPending: 0, highWarnings: 0, mediumWarnings: 1,
    })).toMatchObject({
      level: 'ATTENTION', canAdvance: true,
      reasons: [{ code: 'MEDIUM_WARNINGS', count: 1 }],
    });
  });

  it('marca verde sin bloqueos ni hallazgos relevantes', () => {
    expect(evaluateReadiness({
      blockingPending: 0, nonBlockingPending: 0, highWarnings: 0, mediumWarnings: 0,
    })).toEqual({
      level: 'READY', label: 'Listo',
      summary: 'No hay bloqueos ni advertencias relevantes pendientes.',
      canAdvance: true, reasons: [],
    });
  });
});
