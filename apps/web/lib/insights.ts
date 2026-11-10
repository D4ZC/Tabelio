export type InsightMode = 'local' | 'ai';
export type InsightKind = 'summary' | 'consistency' | 'comparison' | 'classification';
export type SuggestedDocumentType = 'LANDLORD_ID' | 'TENANT_ID' | 'GUARANTOR_ID' | 'PROOF_OF_ADDRESS' | 'OTHER';

export interface InsightSettings {
  aiEnabled: boolean;
  provider: string;
}

export interface InsightResult {
  kind: InsightKind;
  mode: InsightMode;
  generatedAt: string;
  title: string;
  summary: string;
  items: Array<{
    title: string;
    detail: string;
    severity: 'info' | 'warning' | 'high';
    sourceIds: string[];
  }>;
  sources: Array<{ id: string; label: string }>;
  limitations: string[];
  suggestion?: { documentType: SuggestedDocumentType };
  facts?: unknown;
}

export interface InsightRequest {
  kind: InsightKind;
  entityId: string;
  mode: InsightMode;
  revision?: string;
}

export interface InsightRecord {
  scope: string;
  entityId: string;
  result: InsightResult;
}

const suggestedDocumentTypes: SuggestedDocumentType[] = ['LANDLORD_ID', 'TENANT_ID', 'GUARANTOR_ID', 'PROOF_OF_ADDRESS', 'OTHER'];

export const suggestedDocumentLabels: Record<SuggestedDocumentType, string> = {
  LANDLORD_ID: 'Identificación del arrendador',
  TENANT_ID: 'Identificación del arrendatario',
  GUARANTOR_ID: 'Identificación del obligado solidario',
  PROOF_OF_ADDRESS: 'Comprobante de domicilio',
  OTHER: 'Otro documento',
};

export function insightEndpoint(request: Pick<InsightRequest, 'kind' | 'entityId'>) {
  const entity = request.kind === 'summary' || request.kind === 'consistency' ? 'matters' : 'documents';
  return `/insights/${entity}/${encodeURIComponent(request.entityId)}/${request.kind}`;
}

export function insightScope(request: InsightRequest) {
  return JSON.stringify([request.kind, request.entityId, request.mode, request.revision ?? '']);
}

export function insightRecordState(record: InsightRecord | null, request: InsightRequest) {
  const visible = Boolean(record && record.entityId === request.entityId && record.result.kind === request.kind);
  const stale = visible && record?.scope !== insightScope(request);
  return { visible, stale, canUseSuggestion: visible && !stale && Boolean(record?.result.suggestion) };
}

export function insightCitationLabels(sourceIds: string[], sources: InsightResult['sources']) {
  const labels = new Map(sources.map((source) => [source.id, source.label]));
  return {
    labels: [...new Set(sourceIds.flatMap((id) => labels.has(id) ? [labels.get(id)!] : []))],
    missing: sourceIds.some((id) => !labels.has(id)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function parseInsightResult(value: unknown, request: Pick<InsightRequest, 'mode' | 'kind'>): InsightResult {
  if (!isRecord(value) || value.kind !== request.kind || value.mode !== request.mode
    || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))
    || typeof value.title !== 'string' || typeof value.summary !== 'string'
    || !Array.isArray(value.items) || !value.items.every((item) => isRecord(item)
      && typeof item.title === 'string' && typeof item.detail === 'string'
      && ['info', 'warning', 'high'].includes(String(item.severity))
      && Array.isArray(item.sourceIds) && item.sourceIds.every((id) => typeof id === 'string'))
    || !Array.isArray(value.sources) || !value.sources.every((source) => isRecord(source)
      && typeof source.id === 'string' && typeof source.label === 'string')
    || !Array.isArray(value.limitations) || !value.limitations.every((item) => typeof item === 'string')
    || (value.suggestion !== undefined && (!isRecord(value.suggestion)
      || !suggestedDocumentTypes.includes(value.suggestion.documentType as SuggestedDocumentType)))) {
    throw new Error('La respuesta no corresponde al análisis solicitado o está incompleta. Vuelve a intentarlo.');
  }
  return value as unknown as InsightResult;
}

type InsightTransport = (path: string, init: { method: 'POST'; body: string }) => Promise<unknown>;

export async function requestInsight(
  request: InsightRequest,
  settings: InsightSettings | undefined,
  transport: InsightTransport,
  onAiUsageChanged: () => void = () => undefined,
) {
  if (request.mode === 'ai' && !settings?.aiEnabled) {
    throw new Error('El análisis con IA no está disponible. Puedes analizar sin IA.');
  }
  try {
    const response = await transport(insightEndpoint(request), {
      method: 'POST', body: JSON.stringify({ mode: request.mode }),
    });
    return parseInsightResult(response, request);
  } finally {
    if (request.mode === 'ai') onAiUsageChanged();
  }
}

export class InsightRequestCoordinator {
  private scope = '';
  private sequence = 0;

  setScope(scope: string) {
    if (this.scope !== scope) {
      this.scope = scope;
      this.sequence += 1;
    }
  }

  begin(scope: string) {
    this.setScope(scope);
    this.sequence += 1;
    return { scope, sequence: this.sequence };
  }

  isCurrent(ticket: { scope: string; sequence: number }) {
    return ticket.scope === this.scope && ticket.sequence === this.sequence;
  }

  invalidate() {
    this.sequence += 1;
  }
}
