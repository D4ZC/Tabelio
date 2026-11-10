'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch, downloadFromApi } from '@/lib/api';
import type { AuditLogResponse } from '@/lib/types';

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function humanize(value: string) {
  const text = value.replaceAll('_', ' ').toLocaleLowerCase('es-MX');
  return text.charAt(0).toLocaleUpperCase('es-MX') + text.slice(1);
}

export default function AuditPage() {
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 29);
  const [from, setFrom] = useState(dateInput(monthAgo));
  const [to, setTo] = useState(dateInput(today));
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [page, setPage] = useState(1);
  const [log, setLog] = useState<AuditLogResponse>();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  function queryString(includePage = true, targetPage = page) {
    const query = new URLSearchParams({ from, to });
    if (search.trim()) query.set('q', search.trim());
    if (action) query.set('action', action);
    if (entityType) query.set('entityType', entityType);
    if (actorUserId) query.set('actorUserId', actorUserId);
    if (includePage) {
      query.set('page', String(targetPage));
      query.set('pageSize', '25');
    }
    return query.toString();
  }

  async function load(targetPage = page) {
    setLoading(true); setError('');
    try {
      const data = await apiFetch<AuditLogResponse>(`/audit/events?${queryString(true, targetPage)}`);
      setLog(data);
      setPage(data.pagination.page);
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(1); }, []);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await load(1);
  }

  async function exportCsv() {
    setExporting(true); setError('');
    try {
      await downloadFromApi(`/audit/events.csv?${queryString(false)}`, `auditoria-${from}-${to}.csv`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setExporting(false); }
  }

  return <AppShell>
    <header className="page-header audit-header">
      <div><span className="eyebrow">Control administrativo</span><h1>Auditoría</h1><p>Consulta quién hizo qué, cuándo y sobre qué expediente o registro.</p></div>
      <button className="button primary" disabled={exporting || !log} onClick={() => void exportCsv()}>{exporting ? 'Exportando…' : 'Exportar CSV'}</button>
    </header>

    <form className="card audit-filters" onSubmit={applyFilters}>
      <label className="audit-search">Buscar<input value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Acción, referencia, responsable o entidad…" /></label>
      <label>Acción<select value={action} onChange={(event) => setAction(event.target.value)}><option value="">Todas</option>{log?.facets.actions.map((item) => <option value={item} key={item}>{humanize(item)}</option>)}</select></label>
      <label>Entidad<select value={entityType} onChange={(event) => setEntityType(event.target.value)}><option value="">Todas</option>{log?.facets.entityTypes.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label>Responsable<select value={actorUserId} onChange={(event) => setActorUserId(event.target.value)}><option value="">Todos</option><option value="SYSTEM">Sistema / portal</option>{log?.facets.actors.map((actor) => <option value={actor.id} key={actor.id}>{actor.displayName}</option>)}</select></label>
      <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
      <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
      <button className="button secondary" disabled={loading}>Aplicar filtros</button>
    </form>

    {error && <div className="alert error">{error}</div>}
    {log && <section className="metric-row audit-metrics">
      <article className="metric-card accent"><span>Eventos</span><strong>{log.summary.total}</strong><small>en el periodo y filtros actuales</small></article>
      <article className="metric-card"><span>Acciones humanas</span><strong>{log.summary.actorEvents}</strong><small>con usuario identificado</small></article>
      <article className="metric-card"><span>Automatizaciones</span><strong>{log.summary.systemEvents}</strong><small>portal o procesos del sistema</small></article>
      <article className="metric-card"><span>Con expediente</span><strong>{log.summary.withMatter}</strong><small>abren directamente su contexto</small></article>
    </section>}

    <section className="card audit-panel">
      <div className="section-heading"><div><h2>Bitácora organizacional</h2><p>Los registros son de sólo lectura y se muestran del más reciente al más antiguo.</p></div>{log && <span className="tag">Página {log.pagination.page} de {log.pagination.totalPages}</span>}</div>
      {loading && !log ? <div className="page-loader">Consultando la bitácora…</div> : log?.events.length === 0 ? <div className="empty"><strong>Sin eventos</strong><span>No hay actividad que coincida con los filtros.</span></div> : <div className="audit-event-list">
        {log?.events.map((event) => <article key={event.id}>
          <span className="audit-event-mark">{event.actor ? event.actor.displayName.slice(0, 1) : '⚙'}</span>
          <div className="audit-event-copy"><small>{event.entityType} · {event.entityId}</small><strong>{humanize(event.action)}</strong><p>{event.actor ? `${event.actor.displayName} · ${event.actor.email}` : 'Sistema o captura externa'} · {new Date(event.createdAt).toLocaleString('es-MX')}</p>{event.payload && Object.keys(event.payload).length > 0 && <details><summary>Ver detalle técnico</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details>}</div>
          <div className="audit-event-context">{event.matter ? <Link href={`/expedientes/${event.matter.id}`}><strong>{event.matter.reference}</strong><small>{event.matter.title}</small></Link> : <span className="tag">Sin expediente</span>}</div>
        </article>)}
      </div>}
      {log && log.pagination.totalPages > 1 && <div className="audit-pagination"><button className="button secondary" disabled={loading || page <= 1} onClick={() => void load(page - 1)}>← Anterior</button><span>{(page - 1) * log.pagination.pageSize + 1}–{Math.min(page * log.pagination.pageSize, log.pagination.total)} de {log.pagination.total}</span><button className="button secondary" disabled={loading || page >= log.pagination.totalPages} onClick={() => void load(page + 1)}>Siguiente →</button></div>}
    </section>
  </AppShell>;
}
