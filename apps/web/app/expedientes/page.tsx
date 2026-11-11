'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { StatusPill } from '@/components/status-pill';
import { apiFetch } from '@/lib/api';
import { statusLabels, type MatterPage, type MatterSummary, type OperationsDashboard, type Reminder, type RenewalAlert } from '@/lib/types';

const PAGE_SIZE = 50;

const renewalLabels: Record<RenewalAlert['level'], string> = {
  NONE: 'Fuera de ventana',
  DUE_90: 'Vence en 90 días',
  DUE_60: 'Vence en 60 días',
  DUE_30: 'Vence en 30 días',
  DUE_15: 'Vence en 15 días',
  EXPIRED: 'Vencido',
};

export default function MattersPage() {
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [dashboard, setDashboard] = useState<OperationsDashboard>();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reminderBusy, setReminderBusy] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef(0);

  function matterPath(skip: number) {
    const params = new URLSearchParams({ take: String(PAGE_SIZE), skip: String(skip) });
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    return `/matters/page?${params}`;
  }

  useEffect(() => {
    Promise.all([
      apiFetch<OperationsDashboard>('/matters/dashboard'),
      apiFetch<Reminder[]>('/notifications'),
    ])
      .then(([dashboardData, reminderData]) => {
        setDashboard(dashboardData);
        setReminders(reminderData);
      })
      .catch((cause) => setError((cause as Error).message));
  }, []);

  // La búsqueda se resuelve en el servidor: con miles de expedientes no se descarga el listado completo.
  useEffect(() => {
    const current = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      apiFetch<MatterPage>(matterPath(0))
        .then((page) => {
          if (current !== requestId.current) return;
          setMatters(page.items);
          setTotal(page.total);
          setError('');
        })
        .catch((cause) => { if (current === requestId.current) setError((cause as Error).message); })
        .finally(() => { if (current === requestId.current) setLoading(false); });
    }, query ? 300 : 0);
    return () => clearTimeout(timer);
    // matterPath sólo depende de query y status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status]);

  async function loadMore() {
    const current = requestId.current;
    setLoadingMore(true);
    try {
      const page = await apiFetch<MatterPage>(matterPath(matters.length));
      if (current !== requestId.current) return;
      setMatters((previous) => [...previous, ...page.items]);
      setTotal(page.total);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function acknowledgeReminder(reminderId: string) {
    setReminderBusy(reminderId);
    setError('');
    try {
      await apiFetch(`/notifications/${reminderId}/acknowledge`, { method: 'POST' });
      setReminders((current) => current.map((reminder) => reminder.id === reminderId
        ? { ...reminder, status: 'ACKNOWLEDGED', effectiveStatus: 'ACKNOWLEDGED', acknowledgedAt: new Date().toISOString() }
        : reminder));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setReminderBusy('');
    }
  }

  async function syncReminders() {
    setReminderBusy('sync');
    setError('');
    try {
      await apiFetch('/notifications/sync', { method: 'POST' });
      setReminders(await apiFetch<Reminder[]>('/notifications'));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setReminderBusy('');
    }
  }

  const filtered = matters;
  const filtersActive = Boolean(query.trim() || status);

  const active = dashboard?.metrics.active ?? matters.filter((matter) => matter.status === 'ACTIVE').length;
  const integration = dashboard?.metrics.integration ?? matters.filter((matter) => ['DRAFT', 'INTEGRATION', 'PENDING_CLIENT', 'VALIDATION'].includes(matter.status)).length;
  const activeReminders = reminders
    .filter((reminder) => ['DUE', 'SCHEDULED'].includes(reminder.effectiveStatus))
    .sort((left, right) => {
      if (left.effectiveStatus !== right.effectiveStatus) return left.effectiveStatus === 'DUE' ? -1 : 1;
      return new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime();
    });
  const dueReminders = activeReminders.filter((reminder) => reminder.effectiveStatus === 'DUE').length;

  return (
    <AppShell>
      <header className="page-header">
        <div><span className="eyebrow">Operación contractual</span><h1>Expedientes</h1><p>Consulta el avance, los faltantes y la evidencia de cada asunto.</p></div>
        <Link className="button primary" href="/expedientes/nuevo">＋ Nuevo expediente</Link>
      </header>

      <section className="metric-row">
        <article className="metric-card accent"><span>Contratos activos</span><strong>{active}</strong><small>con firma y evidencia completas</small></article>
        <article className="metric-card"><span>En integración</span><strong>{integration}</strong><small>requieren datos o documentos</small></article>
        <article className="metric-card"><span>Por vencer</span><strong>{dashboard?.metrics.renewalWindow ?? 0}</strong><small>{dashboard?.metrics.expired ?? 0} vencido(s)</small></article>
        <article className="metric-card"><span>Revisión y firma</span><strong>{(dashboard?.metrics.review ?? 0) + (dashboard?.metrics.approval ?? 0) + (dashboard?.metrics.signature ?? 0)}</strong><small>pendientes de liberación</small></article>
        <article className="metric-card"><span>En terminación</span><strong>{dashboard?.metrics.termination ?? 0}</strong><small>{dashboard?.metrics.closed ?? 0} expediente(s) cerrado(s)</small></article>
        <article className="metric-card"><span>Recordatorios</span><strong>{activeReminders.length}</strong><small>{dueReminders} requieren atención</small></article>
        <article className="metric-card"><span>Tiempo a activación</span><strong>{dashboard?.metrics.averageDaysToActivation ?? '—'}</strong><small>días promedio desde el alta</small></article>
      </section>

      <section className="card reminder-card">
        <div className="section-heading">
          <div><h2>Recordatorios de renovación</h2><p>Seguimiento persistente; correo y calendario quedan preparados para una integración posterior.</p></div>
          <div className="heading-actions"><span className="tag">{dueReminders} vencido(s)</span><button className="button secondary" type="button" disabled={reminderBusy === 'sync'} onClick={syncReminders}>{reminderBusy === 'sync' ? 'Sincronizando…' : 'Sincronizar'}</button></div>
        </div>
        {activeReminders.length === 0 ? <div className="empty compact"><strong>Sin recordatorios pendientes</strong><span>Se crearán cuatro al activar un arrendamiento con vigencia.</span></div> : <div className="reminder-list">
          {activeReminders.map((reminder) => <article key={reminder.id} className={reminder.effectiveStatus === 'DUE' ? 'due' : ''}>
            <span className="reminder-icon">{reminder.effectiveStatus === 'DUE' ? '!' : reminder.thresholdDays}</span>
            <div><Link href={`/expedientes/${reminder.matterId}`}><strong>{reminder.matter.reference} · {reminder.matter.title}</strong></Link><small>{reminder.matter.property?.displayName ?? 'Sin inmueble'} · aviso de {reminder.thresholdDays} días · {new Date(reminder.scheduledFor).toLocaleDateString('es-MX')}</small></div>
            <div className="reminder-actions"><span className="tag">{reminder.effectiveStatus === 'DUE' ? 'Requiere atención' : 'Programado'}</span><button className="button secondary" type="button" disabled={Boolean(reminderBusy)} onClick={() => acknowledgeReminder(reminder.id)}>{reminderBusy === reminder.id ? 'Guardando…' : 'Marcar atendido'}</button></div>
          </article>)}
        </div>}
      </section>

      {dashboard && dashboard.alerts.length > 0 && <section className="card renewal-alert-card">
        <div className="section-heading"><div><h2>Seguimiento de vigencias</h2><p>Contratos dentro de las ventanas de 90, 60, 30 y 15 días.</p></div><span className="tag">{dashboard.alerts.length} alerta(s)</span></div>
        <div className="renewal-alert-list">
          {dashboard.alerts.map((alert) => <Link href={`/expedientes/${alert.matterId}`} key={alert.matterId}>
            <span className={`renewal-indicator renewal-${alert.renewal.level.toLowerCase()}`}>{alert.renewal.daysRemaining < 0 ? '!' : alert.renewal.daysRemaining}</span>
            <div><strong>{alert.reference} · {alert.title}</strong><small>{alert.property?.displayName ?? 'Sin inmueble'} · vence {new Date(alert.renewal.endDate).toLocaleDateString('es-MX')}</small></div>
            <div className="renewal-alert-meta"><span className="tag">{renewalLabels[alert.renewal.level]}</span><small>{alert.openRenewal ? `Renovación ${alert.openRenewal.reference}` : alert.responsible?.displayName ?? 'Sin responsable'}</small></div>
          </Link>)}
        </div>
      </section>}

      <section className="card table-card">
        <div className="card-toolbar">
          <div><h2>Todos los asuntos</h2><p>{loading ? 'Buscando…' : `${total.toLocaleString('es-MX')} resultado(s)${filtered.length < total ? ` · mostrando ${filtered.length}` : ''}`}</p></div>
          <div className="heading-actions">
            <select className="search" aria-label="Filtrar por estado" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Todos los estados</option>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input className="search" placeholder="Buscar expediente, convenio, persona o inmueble…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        </div>
        {error && <div className="alert error">{error}</div>}
        {loading && filtered.length === 0 ? <div className="empty">Cargando expedientes…</div> : filtered.length === 0 ? (
          filtersActive
            ? <div className="empty"><strong>Sin coincidencias</strong><span>Prueba con otro nombre, número de expediente o convenio.</span></div>
            : <div className="empty"><strong>Aún no hay expedientes</strong><span>Crea el primero para iniciar el flujo guiado.</span></div>
        ) : (
          <div className="data-table">
            <div className="table-row table-head"><span>Expediente</span><span>Tipo</span><span>Inmueble</span><span>Estado</span><span>Vencimiento</span><span>Actividad</span></div>
            {filtered.map((matter) => (
              <Link className="table-row" href={`/expedientes/${matter.id}`} key={matter.id}>
                <span><strong>{matter.reference}</strong><small>{matter.title} · {matter.responsible?.user.displayName ?? 'Sin responsable'}</small></span>
                <span>{matter.kind === 'LEASE' ? 'Arrendamiento' : 'Convenio'}</span>
                <span>{matter.property?.displayName ?? 'Por asignar'}<small>{matter.property ? `${matter.property.city}, ${matter.property.state}` : ''}</small></span>
                <span><StatusPill status={matter.status} /></span>
                <span>{matter.renewal ? <><strong>{new Date(matter.renewal.endDate).toLocaleDateString('es-MX')}</strong><small>{matter.renewal.level === 'NONE' ? `${matter.renewal.daysRemaining} días` : renewalLabels[matter.renewal.level]}</small></> : '—'}</span>
                <span><strong>{matter._count.documents}</strong> doc · <strong>{matter._count.parties}</strong> partes<small>{new Date(matter.updatedAt).toLocaleDateString('es-MX')}</small></span>
              </Link>
            ))}
          </div>
        )}
        {!loading && filtered.length < total && <div className="empty compact">
          <button className="button secondary" type="button" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Cargando…' : `Cargar ${Math.min(PAGE_SIZE, total - filtered.length)} más`}
          </button>
        </div>}
      </section>
    </AppShell>
  );
}
