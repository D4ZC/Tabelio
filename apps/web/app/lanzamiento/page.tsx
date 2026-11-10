'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { AdministrationBreadcrumb } from '@/components/administration-breadcrumb';
import { apiFetch, downloadFromApi } from '@/lib/api';

type LaunchStatus = 'DRAFT' | 'REVIEW' | 'GO' | 'NO_GO';
type UatStatus = 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED';

interface LaunchData {
  program: {
    id: string; name: string; scope: string; status: LaunchStatus; targetEnvironment: 'LOCAL' | 'STAGING' | 'PRODUCTION';
    decisionRationale?: string; snapshotChecksum?: string; decidedAt?: string; updatedAt: string;
  };
  environment: {
    target: string; deploymentExecuted: boolean; checkedAt: string; blockers: number; warnings: number;
    checks: Array<{ code: string; label: string; status: 'PASS' | 'WARNING' | 'BLOCKED'; detail: string }>;
  };
  gates: { ready: boolean; blockers: number; checks: Array<{ code: string; label: string; status: 'PASS' | 'BLOCKED'; detail: string }> };
  summary: { uatPassed: number; uatTotal: number; integrationsAccepted: number; integrationsTotal: number; controlsComplete: number; controlsTotal: number; metricSnapshots: number };
  uatCases: Array<{
    id: string; title: string; category: string; expectedResult: string; status: UatStatus; actualResult?: string; evidence?: string;
    matter?: { reference: string; title: string }; assignedMembership?: { user: { displayName: string } }; reviewedBy?: { displayName: string }; reviewedAt?: string;
  }>;
  integrationChecks: Array<{ id: string; kind: string; provider: string; status: string; evidence?: string; testedAt?: string; testedBy?: { displayName: string } }>;
  complianceControls: Array<{ id: string; code: string; label: string; blocking: boolean; status: string; evidence?: string; completedAt?: string; completedBy?: { displayName: string } }>;
  metricSnapshots: Array<{ id: string; checksum: string; metrics: Record<string, number | string>; gates: { ready: boolean; blockers: number }; capturedAt: string; capturedBy: { displayName: string }; sourcePilotProgram: { name: string; rolloutPercentage: number } }>;
  history: Array<{ id: string; name: string; status: LaunchStatus; targetEnvironment: string; decisionRationale?: string; snapshotChecksum?: string; decidedAt?: string; createdAt: string }>;
}

const categoryLabels: Record<string, string> = {
  FUNCTIONAL: 'Funcional', LEGAL: 'Jurídica', OPERATIONS: 'Operación', SECURITY: 'Seguridad', RESILIENCE: 'Continuidad',
};
const integrationLabels: Record<string, string> = {
  OCR: 'OCR / captura', SIGNATURE: 'Firma', EMAIL: 'Correo', CALENDAR: 'Calendario', PASSWORD_RECOVERY: 'Recuperación',
};
const statusLabels: Record<LaunchStatus, string> = { DRAFT: 'Borrador', REVIEW: 'En revisión', GO: 'Aprobado en local', NO_GO: 'Requiere ajustes' };
const environmentLabels: Record<string, string> = { LOCAL: 'Local', STAGING: 'Pruebas', PRODUCTION: 'Producción' };

export default function LaunchPage() {
  const [data, setData] = useState<LaunchData>();
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState('');
  const [environment, setEnvironment] = useState<'LOCAL' | 'STAGING' | 'PRODUCTION'>('LOCAL');
  const [newCase, setNewCase] = useState({ title: '', category: 'FUNCTIONAL', expectedResult: '' });

  const load = useCallback(async () => {
    const me = await apiFetch<{ role: string }>('/auth/me');
    setRole(me.role);
    if (me.role !== 'ADMIN') return;
    const overview = await apiFetch<LaunchData>('/launch');
    setData(overview);
    setName(overview.program.name);
    setScope(overview.program.scope);
    setEnvironment(overview.program.targetEnvironment);
  }, []);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : 'No se pudo cargar')); }, [load]);
  const canManage = role === 'ADMIN';
  const mutable = data?.program.status === 'DRAFT';
  const latestMetrics = data?.metricSnapshots[0];
  const sortedUat = useMemo(() => data?.uatCases ?? [], [data]);

  async function mutate(path: string, method: 'POST' | 'PATCH', body: object, success: string) {
    setBusy(path); setError(''); setMessage('');
    try {
      await apiFetch(path, { method, body: JSON.stringify(body) });
      setMessage(success);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación');
    } finally { setBusy(''); }
  }

  async function saveProgram(event: FormEvent) {
    event.preventDefault();
    await mutate('/launch/program', 'PATCH', { name, scope, targetEnvironment: environment }, 'Configuración guardada.');
  }

  async function createCase(event: FormEvent) {
    event.preventDefault();
    await mutate('/launch/uat', 'POST', newCase, 'Prueba de aceptación agregada.');
    setNewCase({ title: '', category: 'FUNCTIONAL', expectedResult: '' });
  }

  async function reviewUat(id: string, status: 'PASSED' | 'FAILED') {
    const actualResult = window.prompt('Describe el resultado observado (mínimo 10 caracteres):');
    if (!actualResult) return;
    const evidence = window.prompt('Registra la evidencia o referencia verificable:');
    if (!evidence) return;
    await mutate(`/launch/uat/${id}`, 'PATCH', { status, actualResult, evidence }, status === 'PASSED' ? 'Prueba de aceptación aprobada.' : 'Prueba de aceptación marcada como fallida.');
  }

  async function completeControl(code: string) {
    const evidence = window.prompt('Describe la evidencia del control (mínimo 10 caracteres):');
    if (!evidence) return;
    await mutate(`/launch/controls/${code}/complete`, 'POST', { evidence }, 'Control completado.');
  }

  async function submitReview() {
    const comment = window.prompt('Comentario para someter el ciclo a decisión:');
    if (!comment) return;
    await mutate('/launch/review/submit', 'POST', { comment }, 'Ciclo enviado a decisión.');
  }

  async function decide(decision: 'GO' | 'NO_GO') {
    const rationale = window.prompt(decision === 'GO' ? 'Justificación para aprobar el uso en local:' : 'Describe los ajustes pendientes:');
    if (!rationale) return;
    await mutate('/launch/decision', 'POST', { decision, rationale }, decision === 'GO' ? 'Aprobación local registrada con su evidencia.' : 'Ajustes pendientes registrados.');
  }

  async function startCycle() {
    const reason = window.prompt('Motivo del nuevo ciclo:');
    if (!reason || !data) return;
    await mutate('/launch/program/cycles', 'POST', {
      name: `${data.program.name} · siguiente ciclo`, scope: data.program.scope, targetEnvironment: 'LOCAL', reason,
    }, 'Nuevo ciclo de aceptación iniciado.');
  }

  return <AppShell allowedRoles={['ADMIN']}>
    <AdministrationBreadcrumb current="Revisión y aprobación" />
    <header className="page-header launch-header">
      <div><p className="eyebrow">Revisa los resultados</p><h1>Revisión y aprobación</h1><p>Comprueba las pruebas y la evidencia antes de autorizar el uso. La publicación se gestiona por separado.</p></div>
      <div className="page-actions">
        {canManage && <button className="button secondary" onClick={() => void downloadFromApi('/launch/export.csv', 'preparacion-lanzamiento.csv')}>Exportar evidencia</button>}
        <span className={`launch-decision launch-${data?.program.status.toLowerCase() ?? 'draft'}`}>{data ? statusLabels[data.program.status] : 'Cargando'}</span>
      </div>
    </header>

    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert success">{message}</div>}
    {!data ? <div className="page-loader">Revisando requisitos…</div> : <>
      <section className="card launch-summary">
        <div><span>Decisión</span><strong>{statusLabels[data.program.status]}</strong><small>{data.gates.ready ? 'Todos los requisitos superados' : `${data.gates.blockers} requisito(s) pendiente(s)`}</small></div>
        <div><span>Pruebas de aceptación</span><strong>{data.summary.uatPassed}/{data.summary.uatTotal}</strong><small>casos aprobados</small></div>
        <div><span>Integraciones</span><strong>{data.summary.integrationsAccepted}/{data.summary.integrationsTotal}</strong><small>simuladas o verificadas</small></div>
        <div><span>Cumplimiento</span><strong>{data.summary.controlsComplete}/{data.summary.controlsTotal}</strong><small>controles con evidencia</small></div>
        <div><span>Ambiente</span><strong>{environmentLabels[data.program.targetEnvironment]}</strong><small>entorno de la revisión</small></div>
      </section>

      <section className="card launch-program">
        <div className="section-heading"><div><h2>{data.program.name}</h2><p>{data.program.scope}</p></div><span className="tag">{data.program.targetEnvironment}</span></div>
        {canManage && mutable && <form className="launch-config" onSubmit={saveProgram}>
          <label>Nombre<input minLength={3} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>Alcance<textarea rows={2} minLength={10} maxLength={2000} value={scope} onChange={(event) => setScope(event.target.value)} required /></label>
          <label>Ambiente objetivo<select value={environment} onChange={(event) => setEnvironment(event.target.value as typeof environment)}><option value="LOCAL">Local</option><option value="STAGING">Entorno de pruebas</option><option value="PRODUCTION">Producción</option></select></label>
          <button className="button secondary" disabled={Boolean(busy)}>Guardar</button>
        </form>}
        <div className="launch-actions">
          {canManage && mutable && <button className="button primary" disabled={!data.gates.ready || Boolean(busy)} onClick={() => void submitReview()}>Enviar a revisión</button>}
          {canManage && data.program.status === 'REVIEW' && <><button className="button primary" onClick={() => void decide('GO')}>Aprobar uso en local</button><button className="button danger" onClick={() => void decide('NO_GO')}>Solicitar ajustes</button><button className="button secondary" onClick={() => void mutate('/launch/review/reopen', 'POST', { reason: 'Reapertura solicitada desde el centro de lanzamiento' }, 'Ciclo reabierto.')}>Reabrir</button></>}
          {canManage && ['GO', 'NO_GO'].includes(data.program.status) && <button className="button secondary" onClick={() => void startCycle()}>Iniciar nuevo ciclo</button>}
        </div>
        {data.program.snapshotChecksum && <p className="launch-hash">Evidencia inmutable: <code>{data.program.snapshotChecksum}</code></p>}
      </section>

      <section className="card launch-gates">
        <div className="section-heading"><div><h2>Requisitos de aprobación</h2><p>Cada requisito necesita una comprobación y su evidencia.</p></div><span className={`tag ${data.gates.ready ? 'launch-pass' : 'launch-blocked'}`}>{data.gates.ready ? 'Listo' : 'Bloqueado'}</span></div>
        <div className="launch-gate-grid">{data.gates.checks.map((gate) => <article key={gate.code} className={gate.status === 'PASS' ? 'pass' : 'blocked'}><b>{gate.status === 'PASS' ? '✓' : '!'}</b><div><strong>{gate.label}</strong><small>{gate.detail}</small></div></article>)}</div>
      </section>

      <section className="card launch-section">
        <div className="section-heading"><div><h2>Estado del entorno</h2><p>Consulta el estado del sistema y los pendientes del ambiente seleccionado.</p></div><span className="tag">{data.environment.warnings} advertencia(s)</span></div>
        <div className="launch-check-list">{data.environment.checks.map((check) => <article key={check.code} className={check.status.toLowerCase()}><span>{check.status}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></article>)}</div>
      </section>

      <section className="card launch-section">
        <div className="section-heading"><div><h2>Pruebas de aceptación</h2><p>Comprueba cada proceso y registra el resultado observado.</p></div><span className="tag">{data.summary.uatPassed}/{data.summary.uatTotal}</span></div>
        <div className="launch-uat-list">{sortedUat.map((item) => <article key={item.id} className={`uat-${item.status.toLowerCase()}`}><div><span>{categoryLabels[item.category] ?? item.category}</span><strong>{item.title}</strong><small>{item.expectedResult}</small>{item.evidence && <p>{item.evidence}</p>}</div><div className="launch-row-actions"><em>{item.status}</em>{canManage && mutable && <><button className="link-button" onClick={() => void reviewUat(item.id, 'PASSED')}>Aprobar</button><button className="link-button danger" onClick={() => void reviewUat(item.id, 'FAILED')}>Fallar</button></>}</div></article>)}</div>
        {canManage && mutable && <form className="launch-new-uat" onSubmit={createCase}><input minLength={5} maxLength={180} placeholder="Caso adicional" value={newCase.title} onChange={(event) => setNewCase((current) => ({ ...current, title: event.target.value }))} required /><select value={newCase.category} onChange={(event) => setNewCase((current) => ({ ...current, category: event.target.value }))}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input minLength={10} maxLength={3000} placeholder="Resultado esperado" value={newCase.expectedResult} onChange={(event) => setNewCase((current) => ({ ...current, expectedResult: event.target.value }))} required /><button className="button secondary">Agregar</button></form>}
      </section>

      <div className="launch-two-column">
        <section className="card launch-section"><div className="section-heading"><div><h2>Integraciones</h2><p>Simuladores locales hoy; verificación externa después.</p></div></div><div className="launch-integration-list">{data.integrationChecks.map((item) => <article key={item.id}><div><strong>{integrationLabels[item.kind] ?? item.kind}</strong><small>{item.provider}</small>{item.evidence && <p>{item.evidence}</p>}</div><span className={`tag integration-${item.status.toLowerCase()}`}>{item.status}</span>{canManage && mutable && <button className="link-button" onClick={() => void mutate(`/launch/integrations/${item.kind}/test`, 'POST', {}, `${integrationLabels[item.kind] ?? item.kind} simulado.`)}>Probar</button>}</article>)}</div></section>
        <section className="card launch-section"><div className="section-heading"><div><h2>Seguridad y cumplimiento</h2><p>Controles explícitos con responsable y evidencia.</p></div></div><div className="launch-control-list">{data.complianceControls.map((item) => <article key={item.id}><span className={item.status === 'COMPLETE' ? 'control-complete' : 'control-pending'}>{item.status === 'COMPLETE' ? '✓' : '○'}</span><div><strong>{item.label}</strong><small>{item.evidence ?? 'Pendiente de evidencia'}</small></div>{canManage && mutable && item.status !== 'COMPLETE' && <button className="link-button" onClick={() => void completeControl(item.code)}>Completar</button>}{canManage && mutable && item.status === 'COMPLETE' && <button className="link-button danger" onClick={() => void mutate(`/launch/controls/${item.code}/reopen`, 'POST', { reason: 'Control reabierto para actualizar su evidencia' }, 'Control reabierto.')}>Reabrir</button>}</article>)}</div></section>
      </div>

      <section className="card launch-section">
        <div className="section-heading"><div><h2>Resultados de la prueba inicial</h2><p>Conserva los resultados y una huella de verificación del último ciclo completado.</p></div>{canManage && mutable && <button className="button secondary" onClick={() => void mutate('/launch/metrics/capture', 'POST', {}, 'Métricas capturadas.')}>Capturar fotografía</button>}</div>
        {!latestMetrics ? <div className="empty compact">Aún no hay fotografía de métricas.</div> : <div className="launch-metrics"><article><span>Piloto</span><strong>{latestMetrics.sourcePilotProgram.name}</strong></article><article><span>Adopción registrada</span><strong>{String(latestMetrics.metrics.rolloutPercentage)}%</strong></article><article><span>Muestra conciliada</span><strong>{String(latestMetrics.metrics.matchedCases)}/{String(latestMetrics.metrics.targetCases)}</strong></article><article><span>Incidencias serias</span><strong>{String(latestMetrics.metrics.seriousIssues)}</strong></article><article className="metric-checksum"><span>Huella de verificación</span><code>{latestMetrics.checksum}</code></article></div>}
      </section>

      {data.history.length > 0 && <section className="card launch-section"><div className="section-heading"><div><h2>Historial de decisiones</h2><p>Cada ciclo decidido conserva su fotografía y no se puede modificar.</p></div></div><div className="launch-history">{data.history.map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{item.decisionRationale ?? 'Sin justificación'}</small></div><span className={`launch-decision launch-${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span><time>{new Date(item.decidedAt ?? item.createdAt).toLocaleDateString('es-MX')}</time></article>)}</div></section>}
    </>}
  </AppShell>;
}
