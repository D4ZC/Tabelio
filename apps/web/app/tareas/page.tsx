'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch, downloadFromApi } from '@/lib/api';
import type { OperationalTask, TaskAssignee, TaskDashboard, TaskStatus } from '@/lib/types';

const statusLabels: Record<TaskStatus, string> = {
  TODO: 'Por hacer',
  IN_PROGRESS: 'En curso',
  BLOCKED: 'Bloqueada',
  DONE: 'Completada',
  CANCELLED: 'Cancelada',
};
const priorityLabels = { LOW: 'Baja', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' };
const nextActions: Partial<Record<TaskStatus, Array<{ status: TaskStatus; label: string }>>> = {
  TODO: [{ status: 'IN_PROGRESS', label: 'Iniciar' }, { status: 'CANCELLED', label: 'Cancelar' }],
  IN_PROGRESS: [{ status: 'BLOCKED', label: 'Bloquear' }, { status: 'DONE', label: 'Completar' }],
  BLOCKED: [{ status: 'IN_PROGRESS', label: 'Retomar' }, { status: 'DONE', label: 'Completar' }],
  DONE: [{ status: 'TODO', label: 'Reabrir' }],
  CANCELLED: [{ status: 'TODO', label: 'Reabrir' }],
};

type ValidityTaskSyncResult = {
  eligible: number;
  created: number;
  reopened: number;
  completed: number;
  cancelled: number;
};

type SlaSyncResult = {
  eligible: number;
  escalated: number;
  advanced: number;
  reprioritized: number;
};

function dueLabel(task: OperationalTask) {
  if (!task.dueAt) return 'Sin fecha límite';
  if (task.isOverdue) return `${task.daysOverdue ?? 0} día(s) vencida`;
  if (task.status === 'DONE' || task.status === 'CANCELLED') return new Date(task.dueAt).toLocaleDateString('es-MX');
  if (task.daysRemaining === 0) return 'Vence hoy';
  return `${task.daysRemaining} día(s) restantes`;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<OperationalTask[]>([]);
  const [dashboard, setDashboard] = useState<TaskDashboard>();
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [mineOnly, setMineOnly] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [dueFilter, setDueFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');

  async function load() {
    setError('');
    try {
      const params = new URLSearchParams();
      if (mineOnly) params.set('assignee', 'mine');
      else if (assigneeFilter) params.set('assignee', assigneeFilter);
      if (searchQuery) params.set('q', searchQuery);
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (dueFilter) params.set('due', dueFilter);
      const [taskData, dashboardData, session, assigneeData] = await Promise.all([
        apiFetch<OperationalTask[]>(`/tasks${params.size ? `?${params.toString()}` : ''}`),
        apiFetch<TaskDashboard>('/tasks/dashboard'),
        apiFetch<{ role: string }>('/auth/me'),
        apiFetch<TaskAssignee[]>('/tasks/assignees'),
      ]);
      setTasks(taskData);
      setDashboard(dashboardData);
      setCanManage(['ADMIN', 'LAWYER', 'OPERATOR'].includes(session.role));
      setCanExport(['ADMIN', 'LAWYER'].includes(session.role));
      setAssignees(assigneeData);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [assigneeFilter, dueFilter, mineOnly, priorityFilter, searchQuery, statusFilter]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = searchDraft.trim();
    if (q.length === 1) {
      setError('Escribe al menos 2 caracteres para buscar.');
      return;
    }
    setSearchQuery(q);
  }

  function clearFilters() {
    setSearchDraft('');
    setSearchQuery('');
    setStatusFilter('');
    setPriorityFilter('');
    setDueFilter('');
    setAssigneeFilter('');
    setMineOnly(false);
  }

  async function changeStatus(taskId: string, status: TaskStatus) {
    setBusy(taskId); setError('');
    try {
      let reason: string | undefined;
      if (status === 'BLOCKED') {
        const entered = window.prompt('Explica el bloqueo (mínimo 10 caracteres):');
        if (entered === null) return;
        reason = entered.trim();
        if (reason.length < 10) throw new Error('El motivo del bloqueo debe tener al menos 10 caracteres.');
      }
      await apiFetch(`/tasks/${taskId}/status`, { method: 'POST', body: JSON.stringify({ status, reason }) });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function reschedule(task: OperationalTask) {
    const currentDate = task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 10) : '';
    const enteredDate = window.prompt('Nueva fecha límite (AAAA-MM-DD):', currentDate);
    if (enteredDate === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(enteredDate) || Number.isNaN(new Date(`${enteredDate}T12:00:00`).getTime())) {
      setError('Indica una fecha válida con formato AAAA-MM-DD.');
      return;
    }
    const enteredReason = window.prompt('Motivo de la reprogramación (mínimo 10 caracteres):');
    if (enteredReason === null) return;
    const reason = enteredReason.trim();
    if (reason.length < 10) {
      setError('El motivo de la reprogramación debe tener al menos 10 caracteres.');
      return;
    }
    setBusy(task.id); setError('');
    try {
      const dueAt = new Date(`${enteredDate}T23:59:59`).toISOString();
      await apiFetch(`/tasks/${task.id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ dueAt, reason }),
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function addComment(task: OperationalTask) {
    const entered = window.prompt('Nota de seguimiento (mínimo 3 caracteres):');
    if (entered === null) return;
    const body = entered.trim();
    if (body.length < 3) {
      setError('La nota debe tener al menos 3 caracteres.');
      return;
    }
    setBusy(task.id); setError('');
    try {
      await apiFetch(`/tasks/${task.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function downloadEvidence(document: OperationalTask['evidenceLinks'][number]['document']) {
    setBusy(`evidence-${document.id}`); setError('');
    try {
      await downloadFromApi(`/documents/${document.id}/download`, document.originalName);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function syncDocumentValidity() {
    setBusy('sync-validity'); setError(''); setSyncMessage('');
    try {
      const result = await apiFetch<ValidityTaskSyncResult>('/tasks/document-validity/sync', { method: 'POST' });
      setSyncMessage(
        `${result.eligible} documento(s) requieren seguimiento · ${result.created} tarea(s) nueva(s) · ${result.reopened} reabierta(s) · ${result.completed + result.cancelled} cerrada(s)`,
      );
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function syncSla() {
    setBusy('sync-sla'); setError(''); setSyncMessage('');
    try {
      const result = await apiFetch<SlaSyncResult>('/tasks/sla/sync', { method: 'POST' });
      setSyncMessage(
        `${result.eligible} tarea(s) fuera de SLA · ${result.escalated} escalada(s) · ${result.advanced} subieron de nivel · ${result.reprioritized} prioridad(es) restaurada(s)`,
      );
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function exportTasks() {
    setBusy('export'); setError('');
    try {
      const params = new URLSearchParams();
      if (mineOnly) params.set('assignee', 'mine');
      else if (assigneeFilter) params.set('assignee', assigneeFilter);
      if (searchQuery) params.set('q', searchQuery);
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (dueFilter) params.set('due', dueFilter);
      await downloadFromApi(`/tasks.csv${params.size ? `?${params.toString()}` : ''}`, `tareas-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  const visibleTasks = useMemo(() => tasks.filter((task) => (
    showClosed || Boolean(statusFilter) || !['DONE', 'CANCELLED'].includes(task.status)
  )), [showClosed, statusFilter, tasks]);
  const hasFilters = Boolean(searchQuery || statusFilter || priorityFilter || dueFilter || assigneeFilter || mineOnly);

  return <AppShell>
    <header className="page-header">
      <div><span className="eyebrow">Carga operativa</span><h1>Tareas</h1><p>Prioriza vencimientos, responsables y próximos pasos de todos los expedientes.</p></div>
      <div className="heading-actions">
        {canManage && <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void syncDocumentValidity()}>{busy === 'sync-validity' ? 'Sincronizando…' : 'Sincronizar vigencias'}</button>}
        {canManage && <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void syncSla()}>{busy === 'sync-sla' ? 'Escalando…' : 'Sincronizar SLA'}</button>}
        {canExport && <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void exportTasks()}>{busy === 'export' ? 'Exportando…' : 'Exportar CSV'}</button>}
        <button className={`button ${mineOnly ? 'primary' : 'secondary'}`} type="button" onClick={() => { setMineOnly((value) => !value); setAssigneeFilter(''); }}>{mineOnly ? 'Viendo mis tareas' : 'Ver mis tareas'}</button>
      </div>
    </header>

    <section className="metric-row task-metrics">
      <article className="metric-card accent"><span>Abiertas</span><strong>{dashboard?.metrics.open ?? 0}</strong><small>requieren seguimiento</small></article>
      <article className="metric-card"><span>Vencidas</span><strong>{dashboard?.metrics.overdue ?? 0}</strong><small>fuera del plazo</small></article>
      <article className="metric-card"><span>Bloqueadas</span><strong>{dashboard?.metrics.blocked ?? 0}</strong><small>requieren destrabe</small></article>
      <article className="metric-card"><span>Próximos 7 días</span><strong>{dashboard?.metrics.dueSoon ?? 0}</strong><small>ventana inmediata</small></article>
      <article className="metric-card"><span>Urgentes</span><strong>{dashboard?.metrics.urgent ?? 0}</strong><small>prioridad máxima</small></article>
      <article className="metric-card"><span>Escaladas</span><strong>{dashboard?.metrics.escalated ?? 0}</strong><small>SLA incumplido</small></article>
      <article className="metric-card"><span>Asignadas a mí</span><strong>{dashboard?.metrics.mine ?? 0}</strong><small>carga personal abierta</small></article>
    </section>

    {error && <div className="alert error">{error}</div>}
    {syncMessage && <div className="alert info">{syncMessage}</div>}

    <form className="card task-filter-bar" onSubmit={submitSearch}>
      <label className="task-search-field"><span>Buscar</span><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={100} placeholder="Tarea, expediente o referencia" /></label>
      <label><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label><span>Prioridad</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="">Todas las prioridades</option>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label><span>Vencimiento</span><select value={dueFilter} onChange={(event) => setDueFilter(event.target.value)}><option value="">Cualquier fecha</option><option value="OVERDUE">Vencidas</option><option value="TODAY">Vencen hoy</option><option value="NEXT_7_DAYS">Próximos 7 días</option><option value="NO_DUE_DATE">Sin fecha</option></select></label>
      <label><span>Responsable</span><select value={mineOnly ? 'mine' : assigneeFilter} onChange={(event) => { const value = event.target.value; setMineOnly(value === 'mine'); setAssigneeFilter(value === 'mine' ? '' : value); }}><option value="">Cualquier responsable</option><option value="mine">Mis tareas</option><option value="unassigned">Sin responsable</option>{assignees.map((assignee) => <option value={assignee.id} key={assignee.id}>{assignee.user.displayName}</option>)}</select></label>
      <button className="button secondary" type="submit">Buscar</button>
      {hasFilters && <button className="link-button" type="button" onClick={clearFilters}>Limpiar filtros</button>}
    </form>

    <div className="task-dashboard-grid">
      <section className="card task-priority-panel">
        <div className="section-heading"><div><h2>Atención inmediata</h2><p>Vencidas y próximas a vencer, ordenadas por riesgo.</p></div><span className="tag">{dashboard?.priorityItems.length ?? 0}</span></div>
        {!dashboard?.priorityItems.length ? <div className="empty compact"><strong>Sin vencimientos inmediatos</strong><span>No hay tareas atrasadas ni dentro de los próximos siete días.</span></div> : <div className="task-list compact-list">
          {dashboard.priorityItems.map((task) => <TaskRow task={task} key={task.id} canManage={canManage} busy={busy} onStatus={changeStatus} onReschedule={reschedule} onComment={addComment} onDownloadEvidence={downloadEvidence} />)}
        </div>}
      </section>
      <section className="card workload-panel">
        <div className="section-heading"><div><h2>Carga por responsable</h2><p>Tareas abiertas y presión por vencimiento.</p></div></div>
        {!dashboard?.workload.length ? <div className="empty compact">Sin carga asignada.</div> : <div className="workload-list">
          {dashboard.workload.map((item) => <article key={item.membershipId ?? 'unassigned'}>
            <div className="avatar">{item.displayName.slice(0, 1)}</div>
            <div><strong>{item.displayName}</strong><small>{item.role ?? 'Pendiente de asignar'}</small></div>
            <div><strong>{item.open}</strong><small>abiertas</small></div>
            <div className={item.overdue ? 'task-danger' : ''}><strong>{item.overdue}</strong><small>vencidas</small></div>
          </article>)}
        </div>}
      </section>
    </div>

    <section className="card task-all-panel">
      <div className="section-heading">
        <div><h2>{mineOnly ? 'Mis tareas' : hasFilters ? 'Tareas filtradas' : 'Todas las tareas'}</h2><p>{visibleTasks.length} resultado(s) visibles.</p></div>
        <label className="task-toggle"><input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} /> Mostrar cerradas</label>
      </div>
      {loading ? <div className="empty">Cargando tareas…</div> : visibleTasks.length === 0 ? <div className="empty"><strong>Sin tareas pendientes</strong><span>Las tareas manuales se crean desde cada expediente.</span></div> : <div className="task-list">
        {visibleTasks.map((task) => <TaskRow task={task} key={task.id} canManage={canManage} busy={busy} onStatus={changeStatus} onReschedule={reschedule} onComment={addComment} onDownloadEvidence={downloadEvidence} />)}
      </div>}
    </section>
  </AppShell>;
}

function TaskRow({
  task,
  canManage,
  busy,
  onStatus,
  onReschedule,
  onComment,
  onDownloadEvidence,
}: {
  task: OperationalTask;
  canManage: boolean;
  busy: string;
  onStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  onReschedule: (task: OperationalTask) => Promise<void>;
  onComment: (task: OperationalTask) => Promise<void>;
  onDownloadEvidence: (document: OperationalTask['evidenceLinks'][number]['document']) => Promise<void>;
}) {
  const actions = (nextActions[task.status] ?? []).filter((action) => !(
    task.deduplicationKey?.startsWith('document-validity:')
    && ['DONE', 'CANCELLED'].includes(action.status)
  ));
  return <article className={`task-row ${task.isOverdue ? 'overdue' : ''}`}>
    <span className={`task-priority priority-${task.priority.toLowerCase()}`}>{task.priority.slice(0, 1)}</span>
    <div className="task-copy">
      <Link href={`/expedientes/${task.matterId}`}><strong>{task.title}</strong></Link>
      <small>{task.matter ? `${task.matter.reference} · ${task.matter.title}` : 'Expediente'} · {task.assignee?.user.displayName ?? 'Sin responsable'}</small>
      {task.description && <p>{task.description}</p>}
      {task.status === 'BLOCKED' && task.blockedReason && <p className="task-block-reason"><strong>Bloqueo:</strong> {task.blockedReason}{task.blockedBy ? ` · ${task.blockedBy.displayName}` : ''}</p>}
      {task.dueDateChanges.length > 0 && <details className="task-date-history"><summary>{task.dueDateChanges.length} reprogramación(es)</summary>{task.dueDateChanges.map((change) => <p key={change.id}><strong>{change.previousDueAt ? new Date(change.previousDueAt).toLocaleDateString('es-MX') : 'Sin fecha'} → {new Date(change.newDueAt).toLocaleDateString('es-MX')}</strong><span>{change.reason} · {change.changedBy.displayName} · {new Date(change.createdAt).toLocaleString('es-MX')}</span></p>)}</details>}
      {task.comments.length > 0 && <details className="task-comments"><summary>{task.comments.length} nota(s) de seguimiento</summary>{task.comments.map((comment) => <p key={comment.id}><span>{comment.body}</span><small>{comment.author.displayName} · {new Date(comment.createdAt).toLocaleString('es-MX')}</small></p>)}</details>}
      {task.evidenceLinks.length > 0 && <details className="task-evidence"><summary>{task.evidenceLinks.length} evidencia(s) documental(es)</summary>{task.evidenceLinks.map((link) => <div key={link.id}><button className="link-button" type="button" disabled={busy === `evidence-${link.document.id}`} onClick={() => void onDownloadEvidence(link.document)}>{link.document.originalName} · v{link.document.version}</button><small>{link.linkedBy.displayName} · {new Date(link.linkedAt).toLocaleString('es-MX')}{link.document.invalidatedAt ? ' · Invalidada' : ''}</small></div>)}</details>}
      {task.prerequisites.length > 0 && <details className="task-dependencies"><summary>{task.prerequisites.length} prerrequisito(s)</summary>{task.prerequisites.map((dependency) => <div key={dependency.id}><strong>{dependency.dependsOnTask.title}</strong><small>{statusLabels[dependency.dependsOnTask.status]}</small></div>)}</details>}
    </div>
    <div className="task-meta">
      <div className="task-meta-tags">
        <span className={`tag task-${task.status.toLowerCase()}`}>{statusLabels[task.status]}</span>
        {task.isEscalated && <span className="tag task-escalated">SLA nivel {task.slaEscalationLevel}</span>}
        {task.requiresEvidence && <span className="tag task-evidence-required">Evidencia obligatoria</span>}
        {task.prerequisites.some((dependency) => dependency.dependsOnTask.status !== 'DONE') && <span className="tag task-prerequisites-pending">Prerrequisitos pendientes</span>}
      </div>
      <small className={task.isOverdue ? 'task-danger' : ''}>{dueLabel(task)} · {priorityLabels[task.priority]}</small>
    </div>
    {canManage && <div className="task-actions">{!['CLOSED', 'CANCELLED'].includes(task.matter?.status ?? '') && <button className="link-button" disabled={busy === task.id} type="button" onClick={() => void onComment(task)}>Añadir nota</button>}{task.source === 'MANUAL' && !['DONE', 'CANCELLED'].includes(task.status) && <button className="link-button" disabled={busy === task.id} type="button" onClick={() => void onReschedule(task)}>Reprogramar</button>}{actions.map((action) => <button className="link-button" disabled={busy === task.id} type="button" key={action.status} onClick={() => void onStatus(task.id, action.status)}>{action.label}</button>)}</div>}
  </article>;
}
