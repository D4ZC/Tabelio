export type ReadinessLevel = 'BLOCKED' | 'ATTENTION' | 'READY';

export interface ReadinessInput {
  blockingPending: number;
  nonBlockingPending: number;
  highWarnings: number;
  mediumWarnings: number;
}

export interface ReadinessReason {
  code: 'BLOCKING_REQUIREMENTS' | 'HIGH_WARNINGS' | 'MEDIUM_WARNINGS' | 'RECOMMENDED_REQUIREMENTS';
  count: number;
  label: string;
  source: 'CHECKLIST' | 'CONSISTENCY';
}

export interface ReadinessResult {
  level: ReadinessLevel;
  label: string;
  summary: string;
  canAdvance: boolean;
  reasons: ReadinessReason[];
}

export function evaluateReadiness(input: ReadinessInput): ReadinessResult {
  const reasons: ReadinessReason[] = [];
  if (input.blockingPending > 0) reasons.push({
    code: 'BLOCKING_REQUIREMENTS', count: input.blockingPending,
    label: `${input.blockingPending} requisito(s) bloqueante(s) pendiente(s)`, source: 'CHECKLIST',
  });
  if (input.highWarnings > 0) reasons.push({
    code: 'HIGH_WARNINGS', count: input.highWarnings,
    label: `${input.highWarnings} advertencia(s) de severidad alta`, source: 'CONSISTENCY',
  });
  if (input.mediumWarnings > 0) reasons.push({
    code: 'MEDIUM_WARNINGS', count: input.mediumWarnings,
    label: `${input.mediumWarnings} advertencia(s) de severidad media`, source: 'CONSISTENCY',
  });
  if (input.nonBlockingPending > 0) reasons.push({
    code: 'RECOMMENDED_REQUIREMENTS', count: input.nonBlockingPending,
    label: `${input.nonBlockingPending} requisito(s) recomendado(s) pendiente(s)`, source: 'CHECKLIST',
  });

  if (input.blockingPending > 0) return {
    level: 'BLOCKED',
    label: 'Bloqueado',
    summary: 'Faltan requisitos obligatorios para avanzar.',
    canAdvance: false,
    reasons,
  };
  if (input.highWarnings > 0 || input.mediumWarnings > 0 || input.nonBlockingPending > 0) return {
    level: 'ATTENTION',
    label: 'Requiere atención',
    summary: 'Puede continuar, pero conviene revisar los hallazgos señalados.',
    canAdvance: true,
    reasons,
  };
  return {
    level: 'READY',
    label: 'Listo',
    summary: 'No hay bloqueos ni advertencias relevantes pendientes.',
    canAdvance: true,
    reasons,
  };
}
