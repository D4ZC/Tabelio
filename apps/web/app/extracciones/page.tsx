'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { IdentityExtractionReview } from '@/components/identity-extraction-review';
import { apiFetch, downloadFromApi } from '@/lib/api';
import { IDENTITY_DOCUMENT_TYPES } from '@/lib/identity-review';
import { editableExtractionData, extractedDocumentText } from '@/lib/assistant-documents';
import type { ExtractionQueueResponse, ExtractionSettings, Person } from '@/lib/types';

type ReviewDraft = {
  decision: 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
  data: string;
  comment: string;
};

const decisionLabels = {
  CONFIRMED: 'Confirmar resultado',
  CORRECTED: 'Capturar o corregir',
  REJECTED: 'Rechazar extracción',
};

export default function ExtractionsPage() {
  return <Suspense fallback={<AppShell><div className="page-loader">Cargando extracciones…</div></AppShell>}><ExtractionQueue /></Suspense>;
}

function ExtractionQueue() {
  const documentId = useSearchParams().get('documentId');
  const [queue, setQueue] = useState<ExtractionQueueResponse>();
  const [settings, setSettings] = useState<ExtractionSettings>();
  const [people, setPeople] = useState<Person[]>([]);
  const [notice, setNotice] = useState('');
  const [state, setState] = useState<'PENDING_REVIEW' | 'REVIEWED' | 'ALL'>('PENDING_REVIEW');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load(targetPage = page) {
    setError('');
    try {
      const query = new URLSearchParams({ state, page: String(targetPage), pageSize: '25' });
      if (search) query.set('q', search);
      if (documentId) query.set('documentId', documentId);
      const data = await apiFetch<ExtractionQueueResponse>(`/extractions?${query.toString()}`);
      setQueue(data);
      setPage(data.pagination.page);
      setDrafts((current) => {
        const next = { ...current };
        for (const run of data.runs) {
          if (!next[run.id] && !run.review) {
            const hasProviderData = Boolean(run.rawData && Object.keys(run.rawData).length > 0);
            next[run.id] = {
              decision: hasProviderData ? 'CONFIRMED' : 'CORRECTED',
              data: JSON.stringify(editableExtractionData(run.rawData), null, 2),
              comment: '',
            };
          }
        }
        return next;
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => { void load(1); }, [state, search, documentId]);
  useEffect(() => {
    void apiFetch<ExtractionSettings>('/documents/extraction-settings').then(setSettings).catch(() => undefined);
    void apiFetch<Person[]>('/people').then(setPeople).catch(() => undefined);
  }, []);

  async function identityReviewed(message: string) {
    setNotice(message);
    await load();
    await apiFetch<Person[]>('/people').then(setPeople).catch(() => undefined);
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchDraft.trim());
  }

  function updateDraft(runId: string, patch: Partial<ReviewDraft>) {
    setDrafts((current) => ({ ...current, [runId]: { ...current[runId], ...patch } }));
  }

  async function review(run: ExtractionQueueResponse['runs'][number]) {
    const draft = drafts[run.id];
    if (!draft) return;
    let data: Record<string, unknown> | undefined;
    if (draft.decision !== 'REJECTED') {
      try {
        const parsed = JSON.parse(draft.data);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
        const originalText = extractedDocumentText(run.rawData);
        data = { ...parsed, ...(originalText ? { extractedText: originalText } : {}) };
      } catch {
        setError('Los datos confirmados deben ser un objeto JSON válido.');
        return;
      }
    }
    setBusy(run.id); setError('');
    try {
      await apiFetch(`/documents/${run.document.id}/extractions/${run.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision: draft.decision,
          data,
          comment: draft.comment.trim(),
        }),
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function download(documentId: string, originalName: string) {
    setError('');
    try {
      await downloadFromApi(`/documents/${documentId}/download`, originalName);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return <AppShell>
    <header className="page-header">
      <div><span className="eyebrow">Revisión humana</span><h1>Extracciones</h1><p>Confirma, corrige o rechaza datos antes de incorporarlos al expediente.</p></div>
      <span className="tag">{settings?.enabled ? `Lectura local sin IA · IA opcional: ${settings.provider}` : 'Lectura local sin IA y captura manual'}</span>
    </header>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert info" role="status">{notice}</div>}
    {documentId && <p className="form-hint">Mostrando el documento seleccionado. <Link className="link-button" href="/extracciones">Ver todas las extracciones</Link></p>}

    <form className="card extraction-filter-bar" onSubmit={applySearch}>
      <label>Buscar<input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={100} placeholder="Archivo, expediente o referencia" /></label>
      <label>Estado<select value={state} onChange={(event) => setState(event.target.value as typeof state)}><option value="PENDING_REVIEW">Pendientes</option><option value="REVIEWED">Revisadas</option><option value="ALL">Todas</option></select></label>
      <button className="button secondary">Aplicar</button>
    </form>

    <section className="card extraction-panel">
      <div className="section-heading"><div><h2>Bandeja de extracción</h2><p>Los datos no producen cambios jurídicos automáticos.</p></div><span className="tag">{queue?.pagination.total ?? 0} resultado(s)</span></div>
      {!queue ? <div className="page-loader">Cargando extracciones…</div> : queue.runs.length === 0 ? <div className="empty"><strong>Sin extracciones</strong><span>Solicita una extracción desde los documentos de un expediente.</span></div> : <div className="extraction-list">
        {queue.runs.map((run) => {
          const draft = drafts[run.id];
          return <article key={run.id} className={run.review ? 'reviewed' : ''}>
            <div className="extraction-heading">
              <span className="file-icon">{run.document.mimeType === 'application/pdf' ? 'PDF' : 'DOC'}</span>
              <div><strong>{run.document.originalName}</strong><small>{run.document.matter ? `${run.document.matter.reference} · ${run.document.matter.title}` : 'Sin expediente'} · {run.provider} · {new Date(run.requestedAt).toLocaleString('es-MX')}</small></div>
              <span className={`tag extraction-${run.review ? run.review.decision.toLowerCase() : 'pending'}`}>{run.review ? decisionLabels[run.review.decision] : 'Revisión pendiente'}</span>
            </div>
            {run.message && <p className="extraction-message">{run.message}</p>}
            {extractedDocumentText(run.rawData) && (run.review || !IDENTITY_DOCUMENT_TYPES.includes(run.document.type)) && <label className="extracted-document-text">Texto leído · selecciona para copiar<textarea readOnly rows={10} value={extractedDocumentText(run.rawData)} onFocus={(event) => event.currentTarget.select()} /></label>}
            {!IDENTITY_DOCUMENT_TYPES.includes(run.document.type) && run.fieldCandidates?.length ? <div className="extraction-candidates">{run.fieldCandidates.map((field) => <span key={field.field}><strong>{field.field}</strong>{String(field.value)} · {field.confidence === null ? 'sin confianza' : `${Math.round(field.confidence * 100)}%`}</span>)}</div> : null}
            {run.review ? <div className="extraction-review-summary"><pre>{JSON.stringify(run.review.confirmedData ?? {}, null, 2)}</pre><p>{run.review.comment}</p><small>{run.review.reviewedBy.displayName} · {new Date(run.review.reviewedAt).toLocaleString('es-MX')}</small></div> : IDENTITY_DOCUMENT_TYPES.includes(run.document.type) ? <IdentityExtractionReview key={run.id} run={run} people={people} onReviewed={identityReviewed} /> : draft && <div className="extraction-review-form">
              <label>Decisión<select value={draft.decision} onChange={(event) => updateDraft(run.id, { decision: event.target.value as ReviewDraft['decision'] })}><option value="CONFIRMED">Confirmar resultado del proveedor</option><option value="CORRECTED">Capturar o corregir manualmente</option><option value="REJECTED">Rechazar resultado</option></select></label>
              {draft.decision !== 'REJECTED' && <label>Datos confirmados<textarea rows={8} value={draft.data} onChange={(event) => updateDraft(run.id, { data: event.target.value })} spellCheck={false} /></label>}
              <label>Comentario de revisión<textarea rows={3} minLength={10} maxLength={2000} value={draft.comment} onChange={(event) => updateDraft(run.id, { comment: event.target.value })} placeholder="Explica la validación o corrección realizada…" /></label>
              <button type="button" className="button primary" disabled={busy === run.id || draft.comment.trim().length < 10} onClick={() => void review(run)}>{busy === run.id ? 'Guardando…' : 'Registrar revisión'}</button>
            </div>}
            <div className="extraction-actions">{run.document.matter && <Link className="link-button" href={`/expedientes/${run.document.matter.id}`}>Abrir expediente</Link>}<button type="button" className="link-button" onClick={() => void download(run.document.id, run.document.originalName)}>Descargar original</button></div>
          </article>;
        })}
      </div>}
      {queue && queue.pagination.totalPages > 1 && <div className="audit-pagination"><button className="button secondary" disabled={page <= 1} onClick={() => void load(page - 1)}>← Anterior</button><span>{page} de {queue.pagination.totalPages}</span><button className="button secondary" disabled={page >= queue.pagination.totalPages} onClick={() => void load(page + 1)}>Siguiente →</button></div>}
    </section>
  </AppShell>;
}
