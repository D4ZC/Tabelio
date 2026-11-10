export interface UsageTotal {
  amount: string | null;
  currency: string | null;
  confirmedAmount: string | null;
  estimatedAmount: string | null;
  estimatedCount?: number;
  confirmedCount?: number;
  pendingCount: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageOperation {
  id: string;
  kind: string;
  label: string;
  status: string;
  createdAt: string;
  total: UsageTotal;
}

export interface BrowserBudgetConnection {
  mode: 'w3';
  teamId: string;
  url: string;
  loginUrl: string;
}

export interface TeamCreditBudget {
  teamId: string;
  label: string;
  limit: string | null;
  spent: string;
  remaining: string | null;
  resetAt: string | null;
}

export interface AssistantBudgetView {
  status: 'unavailable' | 'available' | 'stale';
  scope: 'individual' | 'shared' | null;
  currency: string | null;
  limit: string | null;
  spent: string | null;
  remaining: string | null;
  updatedAt: string | null;
  message: string;
  source?: 'desktop_snapshot';
  snapshotReceivedAt?: string;
  snapshotExpiresAt?: string;
  connection?: BrowserBudgetConnection;
  connectionIssue?: 'session' | 'browser' | 'connector' | 'approval';
  team?: TeamCreditBudget;
}

export interface AssistantUsageSummary {
  conversationId: string | null;
  measuredSince: string | null;
  personal: UsageTotal;
  conversation: UsageTotal;
  operations: UsageOperation[];
  latestOperation?: UsageOperation | null;
  budget: AssistantBudgetView;
  pricing?: UsagePricing;
}

export interface UsagePricing {
  status: 'unconfigured' | 'configured';
  message: string;
}

const amountFormatter = new Intl.NumberFormat('es-MX', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export function formatUsageMoney(amount: string | null, currency: string | null): string {
  if (amount === null || !currency) return 'No disponible';
  const parts = amount.match(/^(-?)(\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?$/);
  if (!parts) return 'No disponible';
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return 'No disponible';
  const isNonzero = /[1-9]/.test(parts[2]);
  if (isNonzero && Math.abs(numeric) < 0.000001) {
    return `${amount.startsWith('-') ? '−' : ''}<0.000001 ${currency}`;
  }
  return `${amountFormatter.format(numeric)} ${currency}`;
}

export function usageAmountLabel(total: UsageTotal | undefined, pricing?: UsagePricing): string {
  if (!total) return 'Cargando…';
  if (total.requestCount === 0 && total.pendingCount === 0) return 'Sin consumo';
  if (total.amount === null && total.pendingCount > 0) return pricing?.status === 'unconfigured' ? 'Costo no disponible' : 'Pendiente';
  return formatUsageMoney(total.amount, total.currency);
}

export function usageCostStatus(total: UsageTotal, pricing?: UsagePricing): string {
  if (total.requestCount === 0 && total.pendingCount === 0) return 'Sin llamadas de IA';
  if (total.pendingCount > 0) {
    if (total.amount === null && pricing?.status === 'unconfigured') return 'Tarifa sin configurar';
    const pending = `${total.pendingCount} ${total.pendingCount === 1 ? 'costo pendiente' : 'costos pendientes'}`;
    return total.amount === null ? pending : `${usageHasEstimate(total) ? 'Estimado parcial' : 'Parcial'} · ${pending}`;
  }
  if (total.amount === null || total.currency === null) return 'Costo no disponible';
  if (usageHasEstimate(total)) {
    return (total.confirmedCount ?? 0) > 0 || (total.confirmedAmount !== null && Number(total.confirmedAmount) !== 0)
      ? 'Incluye estimación' : 'Estimado';
  }
  if ((total.confirmedCount ?? 0) > 0) return 'Confirmado';
  // The aggregate contract cannot distinguish a zero-cost estimate from a zero-cost confirmation.
  if (Number(total.confirmedAmount) === 0 && Number(total.estimatedAmount) === 0) return 'Registrado';
  return 'Confirmado';
}

export function usageHasEstimate(total: UsageTotal): boolean {
  return (total.estimatedCount ?? 0) > 0
    || (total.estimatedAmount !== null && (Number(total.estimatedAmount) !== 0 || total.confirmedAmount === null));
}
