'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import type { Clause } from '@/lib/types';

const kindLabels = {
  LEASE: 'Arrendamiento',
  MEDIATION_AGREEMENT: 'Convenio',
};

const versionLabels = {
  DRAFT: 'Borrador',
  APPROVED: 'Vigente',
  RETIRED: 'Retirada',
};

export default function ClausesPage() {
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setClauses(await apiFetch<Clause[]>('/clauses'));
  }

  useEffect(() => {
    apiFetch<{ role: string }>('/auth/me')
      .then((session) => setCanApprove(session.role === 'ADMIN'))
      .catch((cause) => setError((cause as Error).message));
    load().catch((cause) => setError((cause as Error).message));
  }, []);

  async function createClause(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError('');
    try {
      await apiFetch('/clauses', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      form.reset(); setShowForm(false); await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function createVersion(clauseId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') ?? '');
    setBusy(true); setError('');
    try {
      await apiFetch(`/clauses/${clauseId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      form.reset(); await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function approve(clauseId: string, versionId: string) {
    setBusy(true); setError('');
    try {
      await apiFetch(`/clauses/${clauseId}/versions/${versionId}/approve`, { method: 'POST' });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <header className="page-header">
        <div><span className="eyebrow">Biblioteca jurídica</span><h1>Cláusulas</h1><p>Versiones aprobadas, trazables y reutilizables en contratos.</p></div>
        <button className="button primary" onClick={() => setShowForm(!showForm)}>＋ Nueva cláusula</button>
      </header>
      <section className="metric-row">
        <article className="metric-card accent"><span>Cláusulas</span><strong>{clauses.length}</strong><small>en el catálogo del despacho</small></article>
        <article className="metric-card"><span>Versiones vigentes</span><strong>{clauses.filter((clause) => clause.versions.some((version) => version.status === 'APPROVED')).length}</strong><small>disponibles para seleccionar</small></article>
        <article className="metric-card"><span>Pendientes</span><strong>{clauses.filter((clause) => clause.versions.some((version) => version.status === 'DRAFT')).length}</strong><small>requieren aprobación administrativa</small></article>
      </section>
      {error && <div className="alert error">{error}</div>}

      {showForm && <form className="card form-card" onSubmit={createClause}>
        <div className="section-heading"><div><h2>Registrar cláusula</h2><p>La primera versión nace como borrador y no podrá usarse hasta aprobarse.</p></div></div>
        <div className="form-grid">
          <label>Código<input name="code" required minLength={2} maxLength={40} placeholder="PROTECCION_DATOS" /></label>
          <label>Título<input name="title" required minLength={3} maxLength={150} /></label>
          <label>Categoría<input name="category" maxLength={80} placeholder="Cumplimiento" /></label>
          <label>Tipo de expediente<select name="matterKind" defaultValue="LEASE"><option value="LEASE">Arrendamiento</option><option value="MEDIATION_AGREEMENT">Convenio</option></select></label>
          <label className="full">Texto<textarea name="body" rows={8} required minLength={20} maxLength={20000} /></label>
        </div>
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => setShowForm(false)}>Cancelar</button><button className="button primary" disabled={busy}>Guardar borrador</button></div>
      </form>}

      <section className="clause-catalog">
        {clauses.map((clause) => <article className="card clause-card" key={clause.id}>
          <div className="section-heading"><div><span className="eyebrow">{clause.code} · {kindLabels[clause.matterKind]}</span><h2>{clause.title}</h2><p>{clause.category || 'Sin categoría'}</p></div><span className="tag">{clause.versions.length} versión(es)</span></div>
          <div className="clause-versions">
            {clause.versions.map((version) => <div key={version.id}>
              <div className="clause-version-meta"><strong>Versión {version.version}</strong><span className={`tag clause-${version.status.toLowerCase()}`}>{versionLabels[version.status]}</span>{version.status === 'DRAFT' && canApprove && <button className="button secondary" type="button" disabled={busy} onClick={() => void approve(clause.id, version.id)}>Aprobar versión</button>}</div>
              <p>{version.body}</p>
              <small>{version.approvedBy ? `Aprobada por ${version.approvedBy.displayName}` : `Creada por ${version.createdBy?.displayName ?? 'Usuario'}`} · {new Date(version.approvedAt ?? version.createdAt).toLocaleString('es-MX')}</small>
            </div>)}
          </div>
          {!clause.versions.some((version) => version.status === 'DRAFT') && <details className="clause-new-version"><summary>Nueva versión</summary><form onSubmit={(event) => void createVersion(clause.id, event)}><textarea name="body" rows={6} required minLength={20} maxLength={20000} defaultValue={clause.versions[0]?.body} /><button className="button primary" disabled={busy}>Crear borrador</button></form></details>}
        </article>)}
        {clauses.length === 0 && <div className="card empty"><strong>Catálogo vacío</strong><span>Registra la primera cláusula para iniciar el control de versiones.</span></div>}
      </section>
    </AppShell>
  );
}
