export const MATTER_STATUSES = [
  'DRAFT',
  'INTEGRATION',
  'PENDING_CLIENT',
  'VALIDATION',
  'READY_TO_DRAFT',
  'DRAFTING',
  'REVIEW',
  'APPROVAL',
  'SIGNATURE',
  'ACTIVE',
  'RENEWAL_DUE',
  'TERMINATION',
  'CLOSED',
  'CANCELLED',
] as const;

export type MatterStatus = (typeof MATTER_STATUSES)[number];

const allowedTransitions: Record<MatterStatus, readonly MatterStatus[]> = {
  DRAFT: ['INTEGRATION', 'CANCELLED'],
  INTEGRATION: ['PENDING_CLIENT', 'VALIDATION', 'CANCELLED'],
  PENDING_CLIENT: ['INTEGRATION', 'VALIDATION', 'CANCELLED'],
  VALIDATION: ['INTEGRATION', 'READY_TO_DRAFT', 'CANCELLED'],
  READY_TO_DRAFT: ['DRAFTING', 'INTEGRATION', 'CANCELLED'],
  DRAFTING: ['REVIEW', 'READY_TO_DRAFT', 'CANCELLED'],
  REVIEW: ['DRAFTING', 'APPROVAL', 'CANCELLED'],
  APPROVAL: ['DRAFTING', 'SIGNATURE', 'CANCELLED'],
  SIGNATURE: ['APPROVAL', 'ACTIVE', 'CANCELLED'],
  ACTIVE: ['RENEWAL_DUE', 'TERMINATION', 'CLOSED'],
  RENEWAL_DUE: ['ACTIVE', 'TERMINATION', 'CLOSED'],
  TERMINATION: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransition(from: MatterStatus, to: MatterStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertTransition(from: MatterStatus, to: MatterStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Transición no permitida: ${from} → ${to}`);
  }
}

