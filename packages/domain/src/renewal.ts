export const RENEWAL_ALERT_THRESHOLDS = [90, 60, 30, 15] as const;

export type RenewalAlertLevel = 'NONE' | 'DUE_90' | 'DUE_60' | 'DUE_30' | 'DUE_15' | 'EXPIRED';

export interface RenewalAlertSnapshot {
  endDate: string;
  daysRemaining: number;
  level: RenewalAlertLevel;
  thresholdDays: number | null;
}

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function renewalAlertFor(endDate: Date, asOf = new Date()): RenewalAlertSnapshot {
  const daysRemaining = Math.round((utcDay(endDate) - utcDay(asOf)) / 86_400_000);
  let level: RenewalAlertLevel = 'NONE';
  let thresholdDays: number | null = null;

  if (daysRemaining < 0) {
    level = 'EXPIRED';
    thresholdDays = 0;
  } else if (daysRemaining <= 15) {
    level = 'DUE_15';
    thresholdDays = 15;
  } else if (daysRemaining <= 30) {
    level = 'DUE_30';
    thresholdDays = 30;
  } else if (daysRemaining <= 60) {
    level = 'DUE_60';
    thresholdDays = 60;
  } else if (daysRemaining <= 90) {
    level = 'DUE_90';
    thresholdDays = 90;
  }

  return {
    endDate: endDate.toISOString(),
    daysRemaining,
    level,
    thresholdDays,
  };
}
