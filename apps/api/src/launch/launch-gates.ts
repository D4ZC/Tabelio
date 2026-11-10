export interface LaunchGateInput {
  environmentBlockers: number;
  requiredUatCategories: number;
  coveredUatCategories: number;
  totalUatCases: number;
  pendingUatCases: number;
  failedUatCases: number;
  requiredIntegrations: number;
  acceptedIntegrations: number;
  requiredComplianceControls: number;
  completedComplianceControls: number;
  hasMetricSnapshot: boolean;
  metricBlockers: number;
}

export function evaluateLaunchGates(input: LaunchGateInput) {
  const checks = [
    gate('ENVIRONMENT_READY', 'Ambiente verificable', input.environmentBlockers === 0,
      input.environmentBlockers === 0 ? 'Base y almacenamiento disponibles; configuración compatible con el ambiente objetivo.' : `${input.environmentBlockers} bloqueo(s) de ambiente.`),
    gate('UAT_ACCEPTED', 'Aceptación del cliente',
      input.coveredUatCategories === input.requiredUatCategories
        && input.totalUatCases >= input.requiredUatCategories
        && input.pendingUatCases === 0
        && input.failedUatCases === 0,
      `${input.coveredUatCategories}/${input.requiredUatCategories} categorías cubiertas; ${input.pendingUatCases} pendiente(s), ${input.failedUatCases} fallida(s).`),
    gate('INTEGRATIONS_READY', 'Integraciones preparadas', input.acceptedIntegrations === input.requiredIntegrations,
      `${input.acceptedIntegrations}/${input.requiredIntegrations} adaptadores aceptados para el ambiente objetivo.`),
    gate('COMPLIANCE_READY', 'Seguridad y cumplimiento', input.completedComplianceControls === input.requiredComplianceControls,
      `${input.completedComplianceControls}/${input.requiredComplianceControls} controles bloqueantes con evidencia.`),
    gate('PILOT_METRICS_READY', 'Piloto y métricas', input.hasMetricSnapshot && input.metricBlockers === 0,
      input.hasMetricSnapshot ? `${input.metricBlockers} bloqueo(s) en la última fotografía de métricas.` : 'Falta capturar métricas de un piloto completado.'),
  ];
  return { ready: checks.every((item) => item.status === 'PASS'), blockers: checks.filter((item) => item.status === 'BLOCKED').length, checks };
}

function gate(code: string, label: string, passed: boolean, detail: string) {
  return { code, label, status: passed ? 'PASS' as const : 'BLOCKED' as const, blocking: true, detail };
}
