'use client';

import { InsightPanel } from './matter-insights';
import type { InsightSettings, SuggestedDocumentType } from '@/lib/insights';

export function DocumentInsights({ kind, documentId, revision, settings, settingsError, disabled, onUseSuggestion }: {
  kind: 'classification' | 'comparison';
  documentId: string;
  revision: string;
  settings?: InsightSettings;
  settingsError?: string;
  disabled?: boolean;
  onUseSuggestion?: (documentType: SuggestedDocumentType) => void;
}) {
  return <InsightPanel
    kind={kind}
    entityId={documentId}
    revision={revision}
    title={kind === 'classification' ? 'Clasificación sugerida' : 'Explicación de los cambios'}
    description={kind === 'classification'
      ? 'Analiza la evidencia disponible y propone un tipo documental para tu revisión.'
      : 'Interpreta la comparación con la versión anterior. El detalle exacto por párrafo se conserva arriba.'}
    settings={settings}
    settingsError={settingsError}
    disabled={disabled}
    onUseSuggestion={onUseSuggestion}
  />;
}
