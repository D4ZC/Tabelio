'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import type { InboxNotification } from '@/lib/types';

const typeLabels: Record<InboxNotification['type'], string> = {
  MATTER_ASSIGNED: 'Expediente asignado',
  TASK_ASSIGNED: 'Tarea asignada',
  TASK_ESCALATED: 'SLA escalado',
  TASK_COMMENTED: 'Nueva nota',
};

function detail(notification: InboxNotification) {
  if (notification.type === 'MATTER_ASSIGNED') return 'Ahora eres responsable operativo de este expediente.';
  if (notification.type === 'TASK_ESCALATED') {
    const level = Number(notification.payload?.level ?? notification.task?.slaEscalationLevel ?? 0);
    const days = Number(notification.payload?.daysOverdue ?? 0);
    return `La tarea alcanzó el nivel ${level} de SLA con ${days} día(s) de atraso.`;
  }
  if (notification.type === 'TASK_COMMENTED') {
    return `${String(notification.payload?.authorName ?? 'Un integrante')} agregó: ${String(notification.payload?.commentBody ?? '')}`;
  }
  return `Tarea asignada con prioridad ${notification.task?.priority ?? 'NORMAL'}.`;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setNotifications(await apiFetch<InboxNotification[]>('/notifications/inbox'));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function acknowledge(id: string) {
    setBusy(id); setError('');
    try {
      await apiFetch(`/notifications/${id}/acknowledge`, { method: 'POST' });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  const active = useMemo(
    () => notifications.filter((item) => ['DUE', 'SCHEDULED'].includes(item.status)),
    [notifications],
  );
  const visible = showHistory ? notifications : active;
  const escalated = active.filter((item) => item.type === 'TASK_ESCALATED').length;

  return <AppShell>
    <header className="page-header">
      <div><span className="eyebrow">Atención personal</span><h1>Avisos</h1><p>Asignaciones, notas y escalaciones que requieren tu intervención.</p></div>
      <label className="task-toggle"><input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} /> Mostrar historial</label>
    </header>

    <section className="metric-row notification-metrics">
      <article className="metric-card accent"><span>Pendientes</span><strong>{active.length}</strong><small>requieren atención</small></article>
      <article className="metric-card"><span>SLA escalado</span><strong>{escalated}</strong><small>prioridad operativa</small></article>
      <article className="metric-card"><span>Atendidos</span><strong>{notifications.filter((item) => item.status === 'ACKNOWLEDGED').length}</strong><small>con reconocimiento</small></article>
    </section>

    {error && <div className="alert error">{error}</div>}
    <section className="card notification-card">
      <div className="section-heading"><div><h2>{showHistory ? 'Todos mis avisos' : 'Bandeja pendiente'}</h2><p>{visible.length} aviso(s) visible(s).</p></div></div>
      {loading ? <div className="empty">Cargando avisos…</div> : visible.length === 0 ? <div className="empty"><strong>Sin avisos pendientes</strong><span>Las nuevas asignaciones, notas y escalaciones aparecerán aquí.</span></div> : <div className="notification-list">
        {visible.map((notification) => <article className={notification.type === 'TASK_ESCALATED' ? 'escalated' : ''} key={notification.id}>
          <span className="notification-icon">{notification.type === 'TASK_ESCALATED' ? '!' : '✓'}</span>
          <div className="notification-copy">
            <span className="tag">{typeLabels[notification.type]}</span>
            <Link href={`/expedientes/${notification.matterId}`}><strong>{notification.task?.title ?? `${notification.matter.reference} · ${notification.matter.title}`}</strong></Link>
            <p>{detail(notification)}</p>
            <small>{notification.matter.reference} · {new Date(notification.scheduledFor).toLocaleString('es-MX')}</small>
          </div>
          <div className="notification-actions">
            <span className={`tag task-${notification.status.toLowerCase()}`}>{notification.status === 'ACKNOWLEDGED' ? 'Atendido' : notification.status === 'CANCELLED' ? 'Cancelado' : 'Pendiente'}</span>
            {['DUE', 'SCHEDULED'].includes(notification.status) && <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void acknowledge(notification.id)}>{busy === notification.id ? 'Guardando…' : 'Marcar atendido'}</button>}
          </div>
        </article>)}
      </div>}
    </section>
  </AppShell>;
}
