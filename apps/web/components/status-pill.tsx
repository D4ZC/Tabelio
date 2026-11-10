import { statusLabels } from '@/lib/types';

export function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}>{statusLabels[status] ?? status}</span>;
}

