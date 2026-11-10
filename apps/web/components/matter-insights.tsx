'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  InsightRequestCoordinator, insightCitationLabels, insightRecordState, insightScope,
  requestInsight, suggestedDocumentLabels,
  type InsightKind, type InsightMode, type InsightRecord, type InsightSettings, type SuggestedDocumentType,
} from '@/lib/insights';

interface InsightPanelProps {
  kind: InsightKind;
  entityId: string;
  revision: string;
  title: string;
  description: string;
  settings?: InsightSettings;
  settingsError?: string;
  disabled?: boolean;
  onUseSuggestion?: (documentType: SuggestedDocumentType) => void;
}

const actionLabels: Record<InsightKind, string> = {
  summary: 'Generar resumen',
  consistency: 'Revisar inconsistencias',
  comparison: 'Explicar cambios',
  classification: 'Sugerir clasificación',
};

export function InsightPanel({ kind, entityId, revision, title, description, settings, settingsError, disabled = false, onUseSuggestion }: InsightPanelProps) {
  const modeId = useId();
  const [selection, setSelection] = useState<{ entityId: string; kind: InsightKind; mode: InsightMode }>({ entityId, kind, mode: 'local' });
  const mode = selection.entityId === entityId && selection.kind === kind ? selection.mode : 'local';
  const request = { kind, entityId, mode, revision };
  const scope = insightScope(request);
  const coordinator = useRef(new InsightRequestCoordinator());
  coordinator.current.setScope(scope);
  const pendingRef = useRef<{ scope: string; sequence: number } | null>(null);
  const [pending, setPending] = useState<{ scope: string; sequence: number } | null>(null);
  const [record, setRecord] = useState<InsightRecord | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const working = pending?.scope === scope;
  const error = failure?.scope === scope ? failure.message : '';
  const recordState = insightRecordState(record, request);
  const result = recordState.visible ? record?.result : undefined;
  const stale = recordState.stale || Boolean(error && result);

  useEffect(() => {
    const activeCoordinator = coordinator.current;
    return () => activeCoordinator.invalidate();
  }, []);

  async function analyze() {
    if (disabled || pendingRef.current?.scope === scope || (mode === 'ai' && !settings?.aiEnabled)) return;
    const ticket = coordinator.current.begin(scope);
    pendingRef.current = ticket;
    setPending(ticket);
    setFailure(null);
    try {
      const next = await requestInsight(request, settings, (path, init) => apiFetch(path, init), () => {
        window.dispatchEvent(new CustomEvent('assistant:usage-changed'));
      });
      if (coordinator.current.isCurrent(ticket)) setRecord({ scope, entityId, result: next });
    } catch (cause) {
      if (coordinator.current.isCurrent(ticket)) setFailure({ scope, message: (cause as Error).message });
    } finally {
      if (pendingRef.current?.sequence === ticket.sequence) pendingRef.current = null;
      setPending((current) => current?.sequence === ticket.sequence ? null : current);
    }
  }

  return <section className="insight-panel" aria-busy={working}>
    <header><h3>{title}</h3><p>{description}</p></header>
    <div className="insight-controls">
      <label htmlFor={modeId}>Modo de análisis<select id={modeId} value={mode} disabled={disabled || working} onChange={(event) => setSelection({ entityId, kind, mode: event.target.value as InsightMode })}>
        <option value="local">Sin IA · reglas locales</option>
        <option value="ai" disabled={!settings?.aiEnabled}>Con IA{settings?.aiEnabled ? '' : ' · no disponible'}</option>
      </select></label>
      <button type="button" className="button secondary" disabled={disabled || working || (mode === 'ai' && !settings?.aiEnabled)} onClick={() => void analyze()}>
        {working ? 'Analizando…' : `${actionLabels[kind]} ${mode === 'ai' ? 'con IA' : 'sin IA'}`}
      </button>
    </div>
    <p className={`insight-mode-note ${mode === 'ai' ? 'with-ai' : ''}`}>{mode === 'ai'
      ? `Al pulsar el botón se enviarán los datos necesarios a ${settings?.provider || 'el proveedor de IA'} para analizarlos y se generará consumo. Revisa el resultado antes de actuar.`
      : 'Análisis local sin enviar datos a modelos de IA. 0 llamadas de IA · sin consumo del proveedor.'}</p>
    {settingsError && <p className="insight-settings-note">{settingsError} El análisis local sigue disponible.</p>}
    {error && <div className="alert error" role="alert">{error}{result && ' Se conserva el resultado anterior; no se actualizó este análisis.'}</div>}
    {working && <p className="insight-loading" role="status">Preparando el análisis {mode === 'ai' ? 'con IA' : 'local'}…</p>}
    {result && <div className={`insight-result ${stale ? 'is-stale' : ''}`}>
      <div className="insight-result-meta"><span className="tag">{result.mode === 'local' ? 'Sin IA' : 'Con IA'}</span>{stale && <span className="tag insight-stale-tag">Resultado anterior · volver a analizar</span>}<time dateTime={result.generatedAt}>{new Date(result.generatedAt).toLocaleString('es-MX')}</time></div>
      {stale && <p className="insight-stale-note">Este resultado corresponde a un modo o datos anteriores, o no pudo actualizarse. No se aplicarán sus sugerencias.</p>}
      <h4>{result.title}</h4><p className="insight-summary">{result.summary}</p>
      {result.items.length > 0 && <ul className="insight-items">{result.items.map((item, index) => {
        const citations = insightCitationLabels(item.sourceIds, result.sources);
        return <li key={index} className={`insight-item severity-${item.severity}`}>
          <strong>{item.title}</strong><span className="insight-severity-label">{item.severity === 'high' ? 'Prioridad alta' : item.severity === 'warning' ? 'Requiere revisión' : 'Informativo'}</span><p>{item.detail}</p>
          {(citations.labels.length > 0 || citations.missing) && <div className="insight-citations"><span>Fuentes:</span>{citations.labels.map((label) => <span key={label}>{label}</span>)}{citations.missing && <span>Referencia sin fuente disponible</span>}</div>}
        </li>;
      })}</ul>}
      {result.suggestion && <div className="insight-suggestion"><p><strong>Tipo sugerido:</strong> {suggestedDocumentLabels[result.suggestion.documentType]}</p>{onUseSuggestion && <><button type="button" className="button secondary" disabled={disabled || working || stale || !recordState.canUseSuggestion} onClick={() => onUseSuggestion(result.suggestion!.documentType)}>Usar sugerencia</button><small>Sólo rellena el formulario. Revisa las asociaciones y pulsa Guardar corrección para aplicar el cambio.</small></>}</div>}
      {result.sources.length > 0 && <details className="insight-sources"><summary>Fuentes consultadas ({result.sources.length})</summary><ul>{result.sources.map((source, index) => <li key={index}>{source.label}</li>)}</ul></details>}
      {result.limitations.length > 0 && <div className="insight-limitations"><strong>Alcance del análisis</strong><ul>{result.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
    </div>}
  </section>;
}

export function MatterInsights({ matterId, revision, settings, settingsError, disabled }: {
  matterId: string;
  revision: string;
  settings?: InsightSettings;
  settingsError?: string;
  disabled?: boolean;
}) {
  return <section className="card matter-insights">
    <div className="section-heading"><div><h2>Análisis del expediente</h2><p>Consulta hechos y fuentes. Cada análisis conserva tus datos sin modificarlos.</p></div></div>
    <div className="matter-insights-grid">
      <InsightPanel kind="summary" entityId={matterId} revision={revision} title="Resumen del expediente" description="Partes, condiciones, documentos y pendientes relevantes." settings={settings} settingsError={settingsError} disabled={disabled} />
      <InsightPanel kind="consistency" entityId={matterId} revision={revision} title="Análisis de inconsistencias" description="Explica hallazgos y puntos por revisar; las validaciones de reglas continúan abajo." settings={settings} settingsError={settingsError} disabled={disabled} />
    </div>
  </section>;
}
