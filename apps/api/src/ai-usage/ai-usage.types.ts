import type { AuthenticatedUser } from '../auth/auth.types';

export interface UsageTotal {
  amount: string | null;
  currency: string | null;
  confirmedAmount: string | null;
  estimatedAmount: string | null;
  pendingCount: number;
  estimatedCount: number;
  confirmedCount: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface BudgetView {
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
  team?: {
    teamId: string;
    label: string;
    limit: string | null;
    spent: string;
    remaining: string | null;
    resetAt: string | null;
  };
  connection?: {
    mode: 'w3';
    teamId: string;
    url: string;
    loginUrl: string;
    limitPath: string;
    spentPath: string;
    remainingPath: string;
    currency: string;
    currencyPath: string;
  };
}

export interface AiBudgetProvider {
  getBudget(user: AuthenticatedUser): Promise<BudgetView>;
}

export const AI_BUDGET_PROVIDER = Symbol('AI_BUDGET_PROVIDER');

export interface UsageContext {
  organizationId: string;
  userId: string;
  operationId: string;
  conversationId: string | null;
}

export interface ProviderCost {
  amount: string;
  currency: string;
  source: string;
  estimated?: boolean;
}

export interface UsagePricingStatus {
  status: 'unconfigured' | 'configured';
  message: string;
  sourceUrl?: string;
  version?: string;
}

export const unavailableBudget = (): BudgetView => ({
  status: 'unavailable', scope: null, currency: null, limit: null, spent: null,
  remaining: null, updatedAt: null,
  message: 'El presupuesto de IBM todavía no está disponible para esta identidad.',
});
