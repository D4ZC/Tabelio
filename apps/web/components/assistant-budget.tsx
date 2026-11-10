'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  formatUsageMoney,
  usageAmountLabel,
  usageCostStatus,
  usageHasEstimate,
  type AssistantUsageSummary,
  type AssistantBudgetView,
  type UsageTotal,
  type UsagePricing,
} from '@/lib/ai-usage';
import { IBM_CREDIT_UNIT, IBM_USAGE_URL } from '@/lib/ibm-browser-budget';
import { fetchIbmBudgetThroughConnector, getIbmBudgetConnectorStatus } from '@/lib/ibm-budget-connector';
import { canRetainBudgetAfterConnectorFailure, connectorBudgetFailureMessage, connectorBudgetIssue, type ConnectorAvailability } from '@/lib/ibm-budget-connector-ui';

interface SummaryRecord {
  scopeKey: string;
  conversationId: string | null;
  summary: AssistantUsageSummary;
  fetchedAt: string;
}

export function AssistantBudget({
  scopeKey,
  conversationId,
  visible,
  working,
  refreshRevision,
}: {
  scopeKey: string;
  conversationId: string | null;
  visible: boolean;
  working: boolean;
  refreshRevision: number;
}) {
  const [record, setRecord] = useState<SummaryRecord | null>(null);
  const [failedScope, setFailedScope] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [connectorOrigin, setConnectorOrigin] = useState(true);
  const contentId = useId();
  const [manualRevision, setManualRevision] = useState(0);
  const [installationOpen, setInstallationOpen] = useState(false);
  const [connectorAvailability, setConnectorAvailability] = useState<ConnectorAvailability | null>(null);
  const lastManualRevisionRef = useRef(0);
  const browserBudgetRef = useRef<{ key: string; attemptedAt: number; budget: AssistantBudgetView | null } | null>(null);
  const requestScope = `${scopeKey}:${conversationId ?? 'new'}`;
  const currentRecord = record?.scopeKey === scopeKey && record.conversationId === conversationId ? record : null;
  const summary = currentRecord?.summary;
  const failed = failedScope === requestScope;

  useEffect(() => {
    setCollapsed(window.matchMedia('(max-width: 760px)').matches);
    setConnectorOrigin(window.location.origin === 'http://localhost:3000');
  }, []);

  useEffect(() => {
    if (!visible) return;
    const manualRequested = manualRevision !== lastManualRevisionRef.current;
    lastManualRevisionRef.current = manualRevision;
    let active = true;
    let running = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let browserController: AbortController | undefined;
    let browserRunning = false;

    function clearTimer() {
      window.clearTimeout(timer);
      timer = undefined;
    }

    function schedule() {
      clearTimer();
      if (active && !document.hidden) timer = window.setTimeout(() => void refresh(), working ? 2_000 : 60_000);
    }

    async function refreshBrowserBudget(budget: AssistantBudgetView, force: boolean) {
      const connection = budget.connection;
      if (!connection || connection.mode !== 'w3' || browserRunning) return;
      // The desktop extension only exposes its bridge on this approved local origin.
      // Other devices keep the authenticated, timestamped snapshot from the API.
      if (window.location.origin !== 'http://localhost:3000') return;
      const key = `${scopeKey}:${connection.url}`;
      const cached = browserBudgetRef.current?.key === key ? browserBudgetRef.current : null;
      if (!force && cached && Date.now() - cached.attemptedAt < 60_000) return;
      browserRunning = true;
      browserController = new AbortController();
      const requestTimeout = window.setTimeout(() => browserController?.abort(), 10_000);
      let availability: ConnectorAvailability | undefined;
      browserBudgetRef.current = { key, attemptedAt: Date.now(), budget: cached?.budget ?? null };
      try {
        availability = await getIbmBudgetConnectorStatus();
        if (!active) return;
        setConnectorAvailability(availability);
        if (!availability.available || !availability.connected) throw new Error('El conector aún no está conectado a la demo.');
        const result = await fetchIbmBudgetThroughConnector(connection, browserController.signal);
        if (!active) return;
        browserBudgetRef.current = { key, attemptedAt: Date.now(), budget: result };
        setRecord((current) => current?.scopeKey === scopeKey && current.conversationId === conversationId
          && current.summary.budget.connection?.url === connection.url
          ? { ...current, summary: { ...current.summary, budget: result } } : current);
        if (result.status === 'available' && result.scope && result.currency === IBM_CREDIT_UNIT && result.updatedAt && result.spent !== null) {
          // Share display values only, scoped by the authenticated API identity.
          // Credentials and the IBM browser session stay in the desktop extension.
          void apiFetch('/ai-usage/budget-snapshot', {
            method: 'POST',
            body: JSON.stringify({
              teamId: connection.teamId,
              scope: result.scope,
              currency: result.currency,
              limit: result.limit,
              spent: result.spent,
              updatedAt: result.updatedAt,
              ...(result.team ? { team: {
                label: result.team.label, limit: result.team.limit,
                spent: result.team.spent, resetAt: result.team.resetAt,
              } } : {}),
            }),
          }).catch(() => undefined);
        }
      } catch (cause) {
        if (!active) return;
        const issue = connectorBudgetIssue(cause, availability);
        const message = connectorBudgetFailureMessage(issue);
        const lastBudget = canRetainBudgetAfterConnectorFailure(issue) && cached?.budget && cached.budget.status !== 'unavailable'
          ? cached.budget : budget.source === 'desktop_snapshot' ? budget : null;
        const result: AssistantBudgetView = lastBudget ? {
          ...lastBudget, status: 'stale', connectionIssue: issue,
          message: `Se conserva el último saldo conocido. ${message}`,
        } : {
          ...budget, status: 'unavailable', limit: null, spent: null, remaining: null,
          updatedAt: null, team: undefined, connectionIssue: issue, message,
        };
        browserBudgetRef.current = { key, attemptedAt: Date.now(), budget: result };
        setRecord((current) => current?.scopeKey === scopeKey && current.conversationId === conversationId
          && current.summary.budget.connection?.url === connection.url
          ? { ...current, summary: { ...current.summary, budget: result } } : current);
      } finally {
        window.clearTimeout(requestTimeout);
        browserRunning = false;
      }
    }

    async function refresh(forceBrowser = false) {
      if (!active || document.hidden || running) return;
      clearTimer();
      running = true;
      controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller?.abort(), 15_000);
      try {
        const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
        const result = await apiFetch<AssistantUsageSummary>(`/ai-usage/summary${query}`, { signal: controller.signal });
        if (!active) return;
        const key = result.budget.connection ? `${scopeKey}:${result.budget.connection.url}` : null;
        const cached = key && browserBudgetRef.current?.key === key ? browserBudgetRef.current.budget : null;
        const localBudget = window.location.origin === 'http://localhost:3000' && cached?.status !== 'unavailable' ? cached : null;
        setRecord({ scopeKey, conversationId, summary: localBudget ? { ...result, budget: localBudget } : result, fetchedAt: new Date().toISOString() });
        setFailedScope('');
        void refreshBrowserBudget(result.budget, forceBrowser);
      } catch {
        if (active) setFailedScope(requestScope);
      } finally {
        window.clearTimeout(requestTimeout);
        running = false;
        schedule();
      }
    }

    const onVisibility = () => {
      if (document.hidden) clearTimer();
      else void refresh(true);
    };
    const onFocus = () => void refresh(true);
    const onUsageChanged = () => void refresh();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('assistant:usage-changed', onUsageChanged);
    void refresh(manualRequested);
    return () => {
      active = false;
      clearTimer();
      controller?.abort();
      browserController?.abort();
      if (browserRunning && browserBudgetRef.current) browserBudgetRef.current.attemptedAt = 0;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('assistant:usage-changed', onUsageChanged);
    };
  }, [visible, scopeKey, conversationId, requestScope, working, refreshRevision, manualRevision]);

  const budget = summary?.budget;
  const latest = summary?.latestOperation ?? summary?.operations[0];
  const latestInProgress = latest ? ['RUNNING', 'PROCESSING', 'STARTED'].includes(latest.status.toUpperCase()) : false;
  const budgetTitle = budget?.connection && budget.status === 'unavailable'
    ? 'Mi presupuesto IBM' : budget?.scope === 'shared' ? 'Presupuesto compartido' : 'Mi presupuesto';
  const budgetAmount = budget && budget.status !== 'unavailable'
    ? budget.remaining === null && budget.limit === null ? 'Sin límite configurado' : formatUsageMoney(budget.remaining, budget.currency)
    : failed && !summary ? 'No disponible' : summary ? 'No disponible' : 'Cargando…';
  const emptyConversation = !conversationId;
  const chatAmount = emptyConversation ? 'Sin consumo' : failed && !summary ? 'No disponible' : usageAmountLabel(summary?.conversation, summary?.pricing);

  return (
    <div className={`ai-budget${collapsed ? ' is-collapsed' : ''}`} aria-label="Presupuesto y consumo de IA">
      <button
        type="button"
        className="ai-budget-toggle"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        aria-label={collapsed ? 'Mostrar presupuesto y consumo' : 'Ocultar presupuesto y consumo'}
        onClick={() => {
          setCollapsed((current) => !current);
          setDetailOpen(false);
          setInstallationOpen(false);
        }}
      >
        <span className="ai-budget-toggle-title">Presupuesto y consumo
          {collapsed && <span className="ai-budget-compact-amount"><b>{budgetAmount}</b>{budget?.source === 'desktop_snapshot' ? ' · lectura del escritorio' : ' · saldo IBM'}</span>}
        </span>
        <span className="ai-budget-toggle-action">{collapsed ? 'Mostrar' : 'Ocultar'} <span aria-hidden="true">{collapsed ? '▾' : '▴'}</span></span>
      </button>
      <div className="ai-budget-content" id={contentId} hidden={collapsed}>
      <div className="ai-budget-grid">
        <div className="ai-budget-metric">
          <span>{budgetTitle}</span>
          <strong>{budgetAmount}</strong>
          <small>{budget?.source === 'desktop_snapshot' ? 'Lectura del escritorio · no es saldo en vivo' : budget?.status === 'unavailable' && budget.connection ? 'Conecta tu presupuesto IBM' : budget?.status === 'stale' ? 'Último saldo conocido' : budget?.scope === 'shared' ? 'Saldo del equipo IBM' : budget?.currency === IBM_CREDIT_UNIT ? 'Disponible · todos tus equipos' : 'Disponible en IBM'}</small>
        </div>
        <div className="ai-budget-metric">
          <span>Este chat</span>
          <strong>{chatAmount}</strong>
          <small className="ai-budget-cost-status">{summary && !emptyConversation ? costStatusWithSource(summary.conversation, summary.pricing, working) : working ? 'Calculando…' : 'Conversación actual'}</small>
          {summary && <UsageCounts total={summary.conversation} />}
        </div>
        <div className="ai-budget-metric">
          <span className="ai-budget-operation-title" title={latest?.label}>Última operación{latest ? ` · ${latest.label}` : ''}</span>
          <strong>{(working && !latest) || (latestInProgress && latest?.total.requestCount === 0) ? 'Calculando…' : latest ? usageAmountLabel(latest.total, summary?.pricing) : failed ? 'No disponible' : 'Sin operaciones'}</strong>
          <small className="ai-budget-cost-status">{latest ? costStatusWithSource(latest.total, summary?.pricing, latestInProgress) : working ? 'La IA está trabajando' : 'Se mostrará al utilizar IA'}</small>
          {latest && <UsageCounts total={latest.total} />}
        </div>
        <div className="ai-budget-metric">
          <span>Mi consumo · aplicación</span>
          <strong>{failed && !summary ? 'No disponible' : usageAmountLabel(summary?.personal, summary?.pricing)}</strong>
          <small className="ai-budget-cost-status">{summary ? costStatusWithSource(summary.personal, summary.pricing) : 'Acumulado registrado'}</small>
          {summary && <UsageCounts total={summary.personal} />}
        </div>
      </div>
      {budget?.source === 'desktop_snapshot' && <span className="ai-budget-snapshot-note">Consultado en tu computadora: {budget.updatedAt ? formatDate(budget.updatedAt) : 'fecha no disponible'}. El consumo de esta app se actualiza por separado.</span>}
      <div className="ai-budget-footer">
        <span role={failed ? 'status' : undefined}>
          {failed ? 'No se pudo actualizar el registro. Se reintentará la consulta.'
            : working ? 'Registrando llamadas durante la operación'
              : currentRecord ? `Registro actualizado ${formatTime(currentRecord.fetchedAt)}` : 'Consultando registro…'}
        </span>
        <div className="ai-budget-actions">
          <button type="button" onClick={() => setManualRevision((current) => current + 1)}>Actualizar</button>
          <button type="button" aria-expanded={detailOpen} aria-controls="ai-budget-detail" onClick={() => { setDetailOpen((current) => !current); setInstallationOpen(false); }}>
            {detailOpen ? 'Ocultar detalle' : 'Ver detalle'}
          </button>
        </div>
      </div>
      {budget?.connection?.mode === 'w3' && (
        <div className="ai-budget-connection">
          <span>{!connectorOrigin ? budget.source === 'desktop_snapshot' ? 'Actualiza el saldo desde Chrome en tu computadora y pulsa Actualizar aquí.' : 'Para ver tu saldo aquí, consulta el presupuesto en Chrome de tu computadora con esta misma cuenta.'
            : budget.connectionIssue === 'connector' ? 'Instala el conector para consultar tu presupuesto.'
            : budget.connectionIssue === 'approval' ? 'Abre el conector de Chrome y conecta esta demo.'
              : budget.connectionIssue === 'session' ? 'Inicia sesión en IBM desde este perfil de Chrome y conserva abierta la página Uso.'
                : budget.status === 'unavailable' ? 'Consulta IBM no disponible; vuelve a intentar.'
                  : budget.status === 'stale' ? 'Saldo IBM sin actualizar.' : 'Conectado · conserva abierta la página Uso de IBM.'}</span>
          <div className="ai-budget-connection-actions">
            <a href={IBM_USAGE_URL} target="_blank" rel="noopener noreferrer">{budget.status === 'available' ? 'Ver presupuesto IBM ↗' : 'Iniciar sesión IBM ↗'}</a>
            {connectorOrigin && <button type="button" aria-expanded={installationOpen} aria-controls="ai-budget-installation" onClick={() => { setInstallationOpen((current) => !current); setDetailOpen(false); }}>
              {installationOpen ? 'Ocultar pasos' : connectorAvailability?.available ? 'Cómo conectar' : 'Instalar conector'}
            </button>}
          </div>
        </div>
      )}
      {budget?.connection?.mode === 'w3' && installationOpen && (
        <div className="ai-budget-installation" id="ai-budget-installation">
          <strong>Conectar el presupuesto en Chrome</strong>
          <ol>
            <li>Abre <code>chrome://extensions</code> y activa «Modo desarrollador».</li>
            <li>Selecciona «Cargar descomprimida» y elige la carpeta <code>extensions/ibm-budget-connector</code> del proyecto.</li>
            <li>Recarga esta página. Abre el icono del conector en Chrome y pulsa «Conectar esta demo».</li>
            <li>Inicia sesión en Services Essentials en este mismo perfil de Chrome y mantén abierta la página Uso (Usage). Si ya estaba abierta al instalar el conector, recárgala. Vuelve aquí y pulsa «Actualizar».</li>
          </ol>
          <p>La sesión de IBM permanece en Chrome. El conector sólo consulta tu presupuesto para esta demo.</p>
        </div>
      )}
      {detailOpen && (
        <div className="ai-budget-detail" id="ai-budget-detail">
          {budget?.message && <p className="ai-budget-note">{budget.message}</p>}
          {summary?.pricing?.message && <p className="ai-budget-note">{summary.pricing.message}</p>}
          {budget && budget.status !== 'unavailable' && (
            <dl className="ai-budget-official">
              <div><dt>Límite IBM</dt><dd>{budget.limit === null ? 'Sin límite configurado' : formatUsageMoney(budget.limit, budget.currency)}</dd></div>
              <div><dt>Consumido IBM</dt><dd>{formatUsageMoney(budget.spent, budget.currency)}</dd></div>
              <div><dt>Saldo consultado</dt><dd>{budget.updatedAt ? formatDate(budget.updatedAt) : 'Fecha no disponible'}</dd></div>
            </dl>
          )}
          {budget?.scope === 'individual' && budget.team && (
            <dl className="ai-budget-official">
              <div><dt>Equipo IBM</dt><dd>{budget.team.label}</dd></div>
              <div><dt>Disponible del equipo</dt><dd>{budget.team.remaining === null && budget.team.limit === null ? 'Sin límite configurado' : formatUsageMoney(budget.team.remaining, IBM_CREDIT_UNIT)}</dd></div>
              <div><dt>Consumido del equipo</dt><dd>{formatUsageMoney(budget.team.spent, IBM_CREDIT_UNIT)}</dd></div>
              <div><dt>Límite del equipo</dt><dd>{budget.team.limit === null ? 'Sin límite configurado' : formatUsageMoney(budget.team.limit, IBM_CREDIT_UNIT)}</dd></div>
              {budget.team.resetAt && <div><dt>Renovación del equipo</dt><dd>{formatDate(budget.team.resetAt)}</dd></div>}
            </dl>
          )}
          {budget?.currency === IBM_CREDIT_UNIT && <p className="ai-budget-note">El presupuesto usa Advantage Credits; los costos de la aplicación conservan su propia moneda. No se suman ni convierten entre sí.</p>}
          <p className="ai-budget-note">El saldo de IBM puede incluir consumo fuera de esta aplicación. Este desglose muestra el consumo registrado aquí.</p>
          {summary?.measuredSince && <p className="ai-budget-note">Medición en la aplicación desde {formatDate(summary.measuredSince)}.</p>}
          {summary?.personal && <CostBreakdown total={summary.personal} pricing={summary.pricing} label="Mi consumo en la aplicación" />}
          {Boolean(summary?.operations.length) && <p className="ai-budget-note ai-budget-operations-label">Operaciones recientes de este chat</p>}
          {summary?.operations.length ? (
            <ol className="ai-budget-operations">
              {summary.operations.map((operation) => (
                <li key={operation.id}>
                  <div><strong>{operation.label}</strong><span>{formatTime(operation.createdAt)} · {operationState(operation.status)}</span></div>
                  <div><strong>{usageAmountLabel(operation.total, summary.pricing)}</strong><span>{usageCostStatus(operation.total, summary.pricing)}</span></div>
                  <p className="ai-budget-operation-usage">
                    {operation.total.requestCount.toLocaleString('es-MX')} {operation.total.requestCount === 1 ? 'llamada' : 'llamadas'}
                    {' · '}{operation.total.inputTokens.toLocaleString('es-MX')} tokens de entrada
                    {' · '}{operation.total.outputTokens.toLocaleString('es-MX')} de salida
                  </p>
                </li>
              ))}
            </ol>
          ) : <p className="ai-budget-note">{failed ? 'El detalle no está disponible en este momento.' : 'Todavía no hay operaciones registradas en este chat.'}</p>}
        </div>
      )}
      </div>
    </div>
  );
}

function UsageCounts({ total }: { total: UsageTotal }) {
  return <small className="ai-budget-counts">{total.requestCount.toLocaleString('es-MX')} {total.requestCount === 1 ? 'llamada' : 'llamadas'} · {total.inputTokens.toLocaleString('es-MX')} tokens entrada · {total.outputTokens.toLocaleString('es-MX')} salida</small>;
}

function costStatusWithSource(total: UsageTotal, pricing?: UsagePricing, working = false): string {
  if (total.amount !== null && usageHasEstimate(total)) return `${usageCostStatus(total, pricing)} · tarifa de referencia`;
  return working ? 'Calculando…' : usageCostStatus(total, pricing);
}

function CostBreakdown({ total, label, pricing }: { total: UsageTotal; label: string; pricing?: UsagePricing }) {
  return (
    <div className="ai-budget-breakdown">
      <strong>{label}</strong>
      <span>Confirmado: {total.confirmedCount === 0 ? 'Sin cargos confirmados' : formatUsageMoney(total.confirmedAmount, total.currency)}</span>
      <span>Estimado: {total.estimatedCount === 0 ? 'Sin estimaciones' : formatUsageMoney(total.estimatedAmount, total.currency)}</span>
      {total.pendingCount > 0 && <span>{usageCostStatus(total, pricing)}</span>}
      <span>{total.requestCount} {total.requestCount === 1 ? 'llamada' : 'llamadas'} · {total.inputTokens.toLocaleString('es-MX')} tokens de entrada · {total.outputTokens.toLocaleString('es-MX')} de salida</span>
    </div>
  );
}

function operationState(status: string) {
  switch (status.toUpperCase()) {
    case 'RUNNING': case 'PROCESSING': case 'STARTED': return 'En curso';
    case 'FAILED': return 'Finalizó con error';
    case 'PENDING': return 'Pendiente';
    case 'COMPLETE': case 'COMPLETED': case 'SUCCEEDED': return 'Completada';
    default: return 'Registrada';
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Hora no disponible' : date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}
