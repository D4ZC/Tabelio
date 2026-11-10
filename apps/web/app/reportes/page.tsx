'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch, downloadFromApi } from '@/lib/api';
import type { OperationsReport } from '@/lib/types';
import { statusLabels } from '@/lib/types';

const renewalLabels = {
  NONE: 'Fuera de ventana', DUE_90: '90 días', DUE_60: '60 días', DUE_30: '30 días', DUE_15: '15 días', EXPIRED: 'Vencido',
};

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 29);
  const [from, setFrom] = useState(dateInput(monthAgo));
  const [to, setTo] = useState(dateInput(today));
  const [report, setReport] = useState<OperationsReport>();
  const [canExport, setCanExport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  async function loadReport(periodFrom = from, periodTo = to) {
    setLoading(true); setError('');
    try {
      const [data, session] = await Promise.all([
        apiFetch<OperationsReport>(`/reports/operations?from=${encodeURIComponent(periodFrom)}&to=${encodeURIComponent(periodTo)}`),
        apiFetch<{ role: string }>('/auth/me'),
      ]);
      setReport(data);
      setCanExport(['ADMIN', 'LAWYER'].includes(session.role));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadReport(); }, []);

  async function applyPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadReport(from, to);
  }

  async function exportCsv() {
    setExporting(true); setError('');
    try {
      await downloadFromApi(
        `/reports/operations.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        `reporte-operativo-${from}-${to}.csv`,
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const pipelineMax = Math.max(1, ...(report?.pipeline.map((item) => item.count) ?? []));

  return <AppShell>
    <header className="page-header report-header">
      <div><span className="eyebrow">Control de gestión</span><h1>Reportes operativos</h1><p>Productividad, tiempos, carga, cuellos de botella y riesgo contractual.</p></div>
      <form className="report-period" onSubmit={applyPeriod}>
        <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
        <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
        <button className="button secondary" disabled={loading}>Actualizar</button>
        {canExport && <button className="button primary" type="button" disabled={exporting} onClick={() => void exportCsv()}>{exporting ? 'Exportando…' : 'Exportar CSV'}</button>}
      </form>
    </header>

    {error && <div className="alert error">{error}</div>}
    {loading && !report ? <div className="page-loader">Preparando indicadores…</div> : report && <>
      <section className="metric-row report-metrics">
        <article className="metric-card accent"><span>Expedientes creados</span><strong>{report.summary.mattersCreated}</strong><small>{report.summary.leasesCreated} arrendamiento(s) · {report.summary.agreementsCreated} convenio(s)</small></article>
        <article className="metric-card"><span>Documentos</span><strong>{report.summary.documentsAdded}</strong><small>{report.summary.draftsGenerated} borrador(es) generado(s)</small></article>
        <article className="metric-card"><span>Aprobaciones finales</span><strong>{report.summary.finalApprovals}</strong><small>{report.summary.signaturesCompleted} firma(s) completada(s)</small></article>
        <article className="metric-card"><span>Activados</span><strong>{report.summary.mattersActivated}</strong><small>{report.summary.mattersClosed} expediente(s) cerrado(s)</small></article>
        <article className="metric-card"><span>Portal aceptado</span><strong>{report.summary.portalSubmissionsAccepted}</strong><small>capturas incorporadas</small></article>
      </section>

      <div className="report-top-grid">
        <section className="card pipeline-panel">
          <div className="section-heading"><div><h2>Pipeline actual</h2><p>Distribución completa de expedientes por etapa.</p></div></div>
          <div className="pipeline-bars">{report.pipeline.map((item) => <div key={item.status}>
            <span>{statusLabels[item.status] ?? item.status}</span>
            <div><i style={{ width: `${item.count / pipelineMax * 100}%` }} /></div>
            <strong>{item.count}</strong>
          </div>)}</div>
        </section>

        <section className="card cycle-panel">
          <div className="section-heading"><div><h2>Tiempos de ciclo</h2><p>Promedios del periodo seleccionado.</p></div></div>
          <div className="cycle-metrics">
            <article><strong>{report.cycleTimes.averageDaysToActivation ?? '—'}</strong><span>días hasta activación</span></article>
            <article><strong>{report.cycleTimes.averageDaysDraftToApproval ?? '—'}</strong><span>días de borrador a aprobación</span></article>
            <article><strong>{report.taskSla.averageDaysToComplete ?? '—'}</strong><span>días para completar una tarea</span></article>
            <article><strong>{report.taskSla.compliancePercent === null ? '—' : `${report.taskSla.compliancePercent}%`}</strong><span>cumplimiento de SLA</span></article>
          </div>
          <div className="report-note">Cálculos basados en eventos y fechas reales; “—” indica que el periodo aún no tiene una muestra suficiente.</div>
        </section>
      </div>

      <div className="report-middle-grid">
        <section className="card">
          <div className="section-heading"><div><h2>Tareas y SLA</h2><p>Flujo del periodo y presión operativa actual.</p></div></div>
          <div className="report-stat-list">
            <div><span>Creadas en el periodo</span><strong>{report.taskSla.created}</strong></div>
            <div><span>Completadas</span><strong>{report.taskSla.completed}</strong></div>
            <div><span>Completadas a tiempo</span><strong>{report.taskSla.completedOnTime} / {report.taskSla.withDueDate}</strong></div>
            <div><span>Abiertas ahora</span><strong>{report.taskSla.open}</strong></div>
            <div className={report.taskSla.overdue ? 'danger' : ''}><span>Vencidas</span><strong>{report.taskSla.overdue}</strong></div>
            <div className={report.taskSla.blocked ? 'danger' : ''}><span>Bloqueadas</span><strong>{report.taskSla.blocked}</strong></div>
            <div className={report.taskSla.blockedOver48Hours ? 'danger' : ''}><span>Bloqueadas ≥48 h</span><strong>{report.taskSla.blockedOver48Hours}</strong></div>
          </div>
        </section>

        <section className="card">
          <div className="section-heading"><div><h2>Carga por responsable</h2><p>Distribución de todas las tareas abiertas.</p></div></div>
          {report.workload.length === 0 ? <div className="empty compact">Sin tareas abiertas.</div> : <div className="report-workload">
            {report.workload.map((item) => <article key={item.membershipId ?? 'unassigned'}>
              <div className="avatar">{item.displayName.slice(0, 1)}</div>
              <div><strong>{item.displayName}</strong><small>{item.role ?? 'Sin asignar'}</small></div>
              <span><strong>{item.open}</strong><small>abiertas</small></span>
              <span className={item.overdue ? 'task-danger' : ''}><strong>{item.overdue}</strong><small>vencidas</small></span>
              <span><strong>{item.blocked}</strong><small>bloqueadas</small></span>
            </article>)}
          </div>}
        </section>
      </div>

      <section className="card report-risk-panel">
        <div className="section-heading"><div><h2>Riesgo de renovación</h2><p>Contratos activos dentro de ventanas de 90 días o vencidos al corte.</p></div><span className="tag">{report.renewalRisk.total} en riesgo</span></div>
        <div className="risk-summary"><span><strong>{report.renewalRisk.expired}</strong> vencidos</span><span><strong>{report.renewalRisk.due15}</strong> ≤15 días</span><span><strong>{report.renewalRisk.due30}</strong> ≤30 días</span><span><strong>{report.renewalRisk.due60}</strong> ≤60 días</span><span><strong>{report.renewalRisk.due90}</strong> ≤90 días</span></div>
        {report.renewalRisk.items.length === 0 ? <div className="empty compact">Sin contratos en ventana de riesgo.</div> : <div className="report-record-list">
          {report.renewalRisk.items.map((item) => <Link href={`/expedientes/${item.matterId}`} key={item.matterId}>
            <span className={`renewal-indicator renewal-${item.level.toLowerCase()}`}>{item.daysRemaining < 0 ? '!' : item.daysRemaining}</span>
            <div><strong>{item.reference} · {item.title}</strong><small>{item.propertyName ?? 'Sin inmueble'} · {item.responsibleName ?? 'Sin responsable'}</small></div>
            <div><span className="tag">{renewalLabels[item.level]}</span><small>{new Date(item.endDate).toLocaleDateString('es-MX')}</small></div>
          </Link>)}
        </div>}
      </section>

      <section className="card report-bottleneck-panel">
        <div className="section-heading"><div><h2>Cuellos de botella</h2><p>Bloqueos motivados y expedientes sin actividad durante más de {report.bottlenecks.staleAfterDays} días.</p></div><span className="tag">{report.bottlenecks.blockedTasks.length + report.bottlenecks.staleMatters.length}</span></div>
        <div className="report-subsection-heading"><strong>Tareas bloqueadas</strong><small>{report.bottlenecks.blockedTasks.length} bloqueo(s) activo(s)</small></div>
        {report.bottlenecks.blockedTasks.length === 0 ? <div className="empty compact">Sin tareas bloqueadas.</div> : <div className="report-record-list blocked-task-report">
          {report.bottlenecks.blockedTasks.map((item) => <Link href={`/expedientes/${item.matterId}`} key={item.taskId}>
            <span className="stale-days">{item.daysBlocked}d</span>
            <div><strong>{item.title}</strong><small>{item.reference} · {item.responsibleName ?? 'Sin responsable'}</small></div>
            <div><strong>Motivo</strong><small>{item.reason}</small></div>
          </Link>)}
        </div>}
        <div className="report-subsection-heading"><strong>Expedientes sin actividad</strong><small>{report.bottlenecks.staleMatters.length} expediente(s)</small></div>
        {report.bottlenecks.staleMatters.length === 0 ? <div className="empty compact"><strong>Sin expedientes detenidos</strong><span>Todos han tenido actividad dentro de la ventana definida.</span></div> : <div className="report-record-list">
          {report.bottlenecks.staleMatters.map((item) => <Link href={`/expedientes/${item.matterId}`} key={item.matterId}>
            <span className="stale-days">{item.daysWithoutActivity}d</span>
            <div><strong>{item.reference} · {item.title}</strong><small>{statusLabels[item.status] ?? item.status} · {item.responsibleName ?? 'Sin responsable'}</small></div>
            <div><strong>{item.blockingChecklistItems} requisito(s)</strong><small>{item.blockedTasks} tarea(s) bloqueada(s)</small></div>
          </Link>)}
        </div>}
      </section>
    </>}
  </AppShell>;
}
