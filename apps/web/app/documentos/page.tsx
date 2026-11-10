'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { DeleteDocumentButton } from '@/components/delete-document-button';
import { apiFetch, downloadFromApi } from '@/lib/api';
import type {
  DocumentValidityDashboard,
  DocumentValidityStatus,
} from '@/lib/types';

const statusLabels: Record<DocumentValidityStatus, string> = {
  EXPIRED: 'Vencido', DUE_15: 'Vence en 15 días', DUE_30: 'Vence en 30 días',
  DUE_90: 'Vence en 90 días', CURRENT: 'Vigente', UNDATED: 'Sin vencimiento',
};

const documentLabels: Record<string, string> = {
  LANDLORD_ID: 'Identificación del arrendador', TENANT_ID: 'Identificación del arrendatario',
  GUARANTOR_ID: 'Identificación del obligado solidario', TAX_ID: 'Constancia fiscal',
  PROOF_OF_ADDRESS: 'Comprobante de domicilio', PROPERTY_TITLE: 'Acreditación de propiedad',
  GUARANTEE_PROPERTY_TITLE: 'Acreditación de garantía', LEASE_ANNEX: 'Contrato / Anexo 1',
  DRAFT_CONTRACT: 'Borrador contractual', DRAFT_CONTRACT_PDF: 'Vista previa PDF',
  SIGNED_CONTRACT: 'Contrato firmado', TERMINATION_EVIDENCE: 'Evidencia de terminación', OTHER: 'Otro',
};

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function DocumentsPage() {
  const [asOf, setAsOf] = useState(dateInput(new Date()));
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DocumentValidityStatus | ''>('');
  const [page, setPage] = useState(1);
  const [dashboard, setDashboard] = useState<DocumentValidityDashboard>();
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function queryString(targetPage = page) {
    const query = new URLSearchParams({ asOf, page: String(targetPage), pageSize: '25' });
    if (search.trim()) query.set('q', search.trim());
    if (status) query.set('status', status);
    return query.toString();
  }

  async function load(targetPage = page) {
    setLoading(true); setError('');
    try {
      const [data, session] = await Promise.all([
        apiFetch<DocumentValidityDashboard>(`/documents?${queryString(targetPage)}`),
        apiFetch<{ role: string }>('/auth/me'),
      ]);
      setDashboard(data);
      setPage(data.pagination.page);
      setCanManage(['ADMIN', 'LAWYER', 'OPERATOR'].includes(session.role));
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(1); }, []);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await load(1);
  }

  async function updateValidity(documentId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      await apiFetch(`/documents/${documentId}/validity`, {
        method: 'PATCH',
        body: JSON.stringify({
          issuedAt: String(data.get('issuedAt') ?? '') || null,
          expiresAt: String(data.get('expiresAt') ?? '') || null,
        }),
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function download(documentId: string, name: string) {
    setError('');
    try {
      await downloadFromApi(`/documents/${documentId}/download`, name);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return <AppShell>
    <header className="page-header document-center-header">
      <div><span className="eyebrow">Control documental</span><h1>Documentos</h1><p>Vigencia, vencimientos y contexto de todo el repositorio.</p></div>
      <div className="page-actions"><Link className="button secondary" href="/biblioteca">Biblioteca jurídica</Link><span className="tag">Corte {new Date(`${asOf}T12:00:00Z`).toLocaleDateString('es-MX')}</span></div>
    </header>

    <form className="card document-filters" onSubmit={applyFilters}>
      <label>Buscar<input value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Archivo, expediente, persona o inmueble…" /></label>
      <label>Estado<select value={status} onChange={(event) => setStatus(event.target.value as DocumentValidityStatus | '')}><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Fecha de corte<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} required /></label>
      <button className="button secondary" disabled={loading}>Aplicar filtros</button>
    </form>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert info" role="status">{notice}</div>}
    {dashboard && <section className="metric-row document-validity-metrics">
      <article className="metric-card accent"><span>Total</span><strong>{dashboard.summary.all}</strong><small>documentos en la organización</small></article>
      <article className={`metric-card ${dashboard.summary.expired ? 'metric-danger' : ''}`}><span>Vencidos</span><strong>{dashboard.summary.expired}</strong><small>dejan de completar el checklist</small></article>
      <article className="metric-card"><span>≤15 días</span><strong>{dashboard.summary.due15}</strong><small>atención inmediata</small></article>
      <article className="metric-card"><span>16–30 días</span><strong>{dashboard.summary.due30}</strong><small>renovación próxima</small></article>
      <article className="metric-card"><span>31–90 días</span><strong>{dashboard.summary.due90}</strong><small>ventana preventiva</small></article>
      <article className="metric-card"><span>Sin fecha</span><strong>{dashboard.summary.undated}</strong><small>no sujetos a vencimiento registrado</small></article>
    </section>}

    <section className="card document-center-panel">
      <div className="section-heading"><div><h2>Repositorio organizacional</h2><p>Fechas editables por perfiles con permiso de carga documental.</p></div>{dashboard && <span className="tag">{dashboard.pagination.total} resultado(s)</span>}</div>
      {loading && !dashboard ? <div className="page-loader">Revisando vigencias…</div> : dashboard?.documents.length === 0 ? <div className="empty"><strong>Sin documentos</strong><span>No existen archivos que coincidan con los filtros.</span></div> : <div className="document-center-list">
        {dashboard?.documents.map((document) => <article key={document.id}>
          <span className={`document-validity-icon validity-${document.validityStatus.toLowerCase()}`}>{document.mimeType === 'application/pdf' ? 'PDF' : 'DOC'}</span>
          <div className="document-center-copy"><small>{document.libraryLinks?.[0]?.libraryDocument.documentTypeLabel ?? documentLabels[document.type] ?? document.type} · v{document.version}</small><strong>{document.originalName}</strong><p>{document.matter ? `${document.matter.reference} · ${document.matter.title}` : document.person?.legalName ?? document.property?.displayName ?? 'Repositorio general'} · cargado por {document.uploadedBy.displayName}</p>{document.libraryLinks?.map(({ libraryDocument }) => <p key={libraryDocument.id}><Link className="link-button" href={`/biblioteca?documentId=${encodeURIComponent(libraryDocument.id)}${document.matter ? `&matterId=${encodeURIComponent(document.matter.id)}` : ''}`}>Referencia de {libraryDocument.source} · {libraryDocument.packageLabel}</Link></p>)}<span className={`tag validity-${document.validityStatus.toLowerCase()}`}>{statusLabels[document.validityStatus]}{document.daysRemaining !== null ? ` · ${document.daysRemaining} día(s)` : ''}</span></div>
          {canManage ? <form className="document-validity-form" key={`${document.id}-${document.issuedAt}-${document.expiresAt}`} onSubmit={(event) => void updateValidity(document.id, event)}>
            <label>Emisión<input name="issuedAt" type="date" defaultValue={document.issuedAt?.slice(0, 10)} /></label>
            <label>Vencimiento<input name="expiresAt" type="date" defaultValue={document.expiresAt?.slice(0, 10)} /></label>
            <button className="button secondary" disabled={busy}>Guardar fechas</button>
          </form> : <div className="document-validity-dates"><small>Emisión</small><strong>{document.issuedAt ? new Date(document.issuedAt).toLocaleDateString('es-MX', { timeZone: 'UTC' }) : '—'}</strong><small>Vencimiento</small><strong>{document.expiresAt ? new Date(document.expiresAt).toLocaleDateString('es-MX', { timeZone: 'UTC' }) : '—'}</strong></div>}
          <div className="document-center-actions">{document.matter && <Link className="link-button" href={`/expedientes/${document.matter.id}`}>Abrir expediente</Link>}<button type="button" className="link-button" onClick={() => void download(document.id, document.originalName)}>Descargar</button>{canManage && <DeleteDocumentButton document={document} matterStatus={document.matter?.status} disabled={busy} onBusyChange={setBusy} onError={setError} onDeleted={async () => {
            await load(dashboard.documents.length === 1 && page > 1 ? page - 1 : page);
            setNotice('Archivo eliminado definitivamente. La operación quedó registrada en la bitácora.');
          }} />}</div>
        </article>)}
      </div>}
      {dashboard && dashboard.pagination.totalPages > 1 && <div className="audit-pagination"><button className="button secondary" disabled={loading || page <= 1} onClick={() => void load(page - 1)}>← Anterior</button><span>{(page - 1) * dashboard.pagination.pageSize + 1}–{Math.min(page * dashboard.pagination.pageSize, dashboard.pagination.total)} de {dashboard.pagination.total}</span><button className="button secondary" disabled={loading || page >= dashboard.pagination.totalPages} onClick={() => void load(page + 1)}>Siguiente →</button></div>}
    </section>
  </AppShell>;
}
