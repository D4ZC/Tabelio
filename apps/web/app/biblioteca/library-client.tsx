'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch, downloadFromApi } from '@/lib/api';
import { libraryLabel, summarizeLibraryAttachment } from '@/lib/library';
import type { LibraryAttachResponse, LibraryDetail, LibraryDocument, LibraryFacet, LibraryResponse } from '@/lib/library';
import type { MatterSummary } from '@/lib/types';
import './biblioteca.css';

const emptyFilters = { q: '', source: '', documentType: '', legalFamily: '', variant: '', usage: '', packageId: '' };
type Filters = typeof emptyFilters;

function FacetSelect({ label, name, value, options, disabled, onChange }: {
  label: string; name: keyof Filters; value: string; options: LibraryFacet[]; disabled: boolean;
  onChange: (name: keyof Filters, value: string) => void;
}) {
  return <label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(name, event.target.value)}>
    <option value="">Todos</option>
    {value && !options.some((option) => option.value === value) && <option value={value}>{libraryLabel(value)}</option>}
    {options.map((option) => <option value={option.value} key={option.value}>{option.label} ({option.count})</option>)}
  </select></label>;
}

function ReviewList({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return <section className="library-review-section"><h3>{title}</h3><ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul></section>;
}

export function LibraryClient({ initialMatterId, initialDocumentId }: { initialMatterId: string; initialDocumentId: string }) {
  const [draftFilters, setDraftFilters] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [catalog, setCatalog] = useState<LibraryResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(initialDocumentId);
  const preferredDocumentId = useRef(initialDocumentId);
  const selectionRevision = useRef(0);
  const [detailState, setDetailState] = useState<{ id: string; data: LibraryDetail }>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const [role, setRole] = useState('');
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [mattersLoading, setMattersLoading] = useState(true);
  const [mattersError, setMattersError] = useState('');
  const [mattersRetry, setMattersRetry] = useState(0);
  const [matterId, setMatterId] = useState(initialMatterId);
  const [includePackage, setIncludePackage] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const attachLock = useRef(false);
  const [attachResult, setAttachResult] = useState<LibraryAttachResponse>();
  const [attachError, setAttachError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const detailHeading = useRef<HTMLHeadingElement>(null);

  const query = new URLSearchParams({ page: String(page), pageSize: '15' });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const queryString = query.toString();
  const detail = detailState?.id === selectedId ? detailState.data : undefined;
  const canAttach = ['ADMIN', 'LAWYER', 'OPERATOR'].includes(role);
  const eligibleMatters = matters.filter((matter) => !['CLOSED', 'CANCELLED'].includes(matter.status));
  const selectedMatter = eligibleMatters.find((matter) => matter.id === matterId);
  const finishedMatter = matters.find((matter) => matter.id === matterId && ['CLOSED', 'CANCELLED'].includes(matter.status));
  const related = detail?.relatedDocuments.filter((document) => document.id !== detail.id) ?? [];
  const attachSummary = attachResult ? summarizeLibraryAttachment(attachResult.results) : undefined;

  useEffect(() => {
    const controller = new AbortController();
    const revisionAtRequest = selectionRevision.current;
    setLoading(true); setError('');
    apiFetch<LibraryResponse>(`/library/documents?${queryString}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setCatalog(data);
        const preferred = preferredDocumentId.current;
        preferredDocumentId.current = '';
        const selectionChanged = selectionRevision.current !== revisionAtRequest;
        setSelectedId((current) => selectionChanged ? current : preferred || (data.documents.some((document) => document.id === current) ? current : data.documents[0]?.id ?? ''));
        if (data.pagination.page !== page) setPage(data.pagination.page);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError((cause as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [queryString, reload, page, initialDocumentId]);

  useEffect(() => {
    if (!selectedId) { setDetailState(undefined); setDetailLoading(false); setDetailError(''); return; }
    const controller = new AbortController();
    setDetailLoading(true); setDetailError(''); setDownloadError('');
    setIncludePackage(false); setAttachResult(undefined); setAttachError('');
    apiFetch<LibraryDetail>(`/library/documents/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setDetailState({ id: selectedId, data }); })
      .catch((cause) => { if (!controller.signal.aborted) setDetailError((cause as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, detailRetry]);

  useEffect(() => {
    const controller = new AbortController();
    setMattersLoading(true); setMattersError('');
    async function loadMatters() {
      try {
        const session = await apiFetch<{ role: string }>('/auth/me', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setRole(session.role);
        if (['ADMIN', 'LAWYER', 'OPERATOR'].includes(session.role)) {
          const data = await apiFetch<MatterSummary[]>('/matters', { signal: controller.signal });
          if (!controller.signal.aborted) setMatters(data);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setMattersError((cause as Error).message);
      } finally {
        if (!controller.signal.aborted) setMattersLoading(false);
      }
    }
    void loadMatters();
    return () => controller.abort();
  }, [mattersRetry]);

  useEffect(() => { setMatterId(initialMatterId); }, [initialMatterId]);

  useEffect(() => {
    preferredDocumentId.current = initialDocumentId;
    if (initialDocumentId) setSelectedId(initialDocumentId);
  }, [initialDocumentId]);

  function changeFilter(name: keyof Filters, value: string) {
    setDraftFilters((current) => ({ ...current, [name]: value }));
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1); setFilters({ ...draftFilters, q: draftFilters.q.trim() });
    setReload((current) => current + 1);
  }

  function selectDocument(document: LibraryDocument, moveFocus = false) {
    if (attachLock.current) return;
    selectionRevision.current += 1;
    preferredDocumentId.current = '';
    setSelectedId(document.id);
    if (moveFocus) {
      detailHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      detailHeading.current?.focus({ preventScroll: true });
    }
  }

  async function download() {
    if (!detail || downloading) return;
    setDownloading(true); setDownloadError('');
    try {
      const fileName = detail.originalPath.split(/[\\/]/).pop() || `${detail.title}.doc`;
      await downloadFromApi(`/library/documents/${encodeURIComponent(detail.id)}/download`, fileName);
    } catch (cause) { setDownloadError((cause as Error).message); }
    finally { setDownloading(false); }
  }

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !selectedMatter || !canAttach || loading || detailLoading || attachLock.current) return;
    attachLock.current = true; setAttaching(true); setAttachError(''); setAttachResult(undefined);
    try {
      const result = await apiFetch<LibraryAttachResponse>(`/library/documents/${encodeURIComponent(detail.id)}/attach`, {
        method: 'POST', body: JSON.stringify({ matterId: selectedMatter.id, includePackage }),
      });
      setAttachResult(result);
    } catch (cause) { setAttachError((cause as Error).message); }
    finally { attachLock.current = false; setAttaching(false); }
  }

  const facets = catalog?.facets;

  return <AppShell><div className="library-page">
    <header className="page-header library-header">
      <div><span className="eyebrow">Conocimiento del despacho</span><h1>Biblioteca jurídica</h1><p>Consulta los modelos de Saul y Alex por tipo y materia y agrégalos como referencia a un expediente.</p></div>
      <Link className="button secondary" href={initialMatterId ? `/expedientes/${encodeURIComponent(initialMatterId)}` : '/documentos'}>{initialMatterId ? 'Volver al expediente' : 'Ver documentos'}</Link>
    </header>

    {catalog && <section className="library-summary" aria-label="Resumen de la biblioteca">
      <article><strong>{catalog.summary.total}</strong><span>documentos catalogados</span></article>
      <article><strong>{catalog.summary.uniqueFiles}</strong><span>archivos diferentes</span></article>
      <article><strong>{catalog.summary.packages}</strong><span>conjuntos relacionados</span></article>
      <article><strong>{Object.entries(catalog.summary.bySource).map(([source, count]) => `${source}: ${count}`).join(' · ')}</strong><span>procedencia conservada</span></article>
    </section>}

    <form className="card library-filters" onSubmit={applyFilters}>
      <label className="library-search">Buscar<input value={draftFilters.q} maxLength={100} disabled={attaching} onChange={(event) => changeFilter('q', event.target.value)} placeholder="Contrato, oficio, nombre o contenido…" /></label>
      <FacetSelect label="Origen" name="source" value={draftFilters.source} options={facets?.sources ?? []} disabled={attaching} onChange={changeFilter} />
      <FacetSelect label="Tipo de documento" name="documentType" value={draftFilters.documentType} options={facets?.documentTypes ?? []} disabled={attaching} onChange={changeFilter} />
      <FacetSelect label="Materia" name="legalFamily" value={draftFilters.legalFamily} options={facets?.legalFamilies ?? []} disabled={attaching} onChange={changeFilter} />
      <FacetSelect label="Variante" name="variant" value={draftFilters.variant} options={facets?.variants ?? []} disabled={attaching} onChange={changeFilter} />
      <FacetSelect label="Uso propuesto" name="usage" value={draftFilters.usage} options={facets?.usages ?? []} disabled={attaching} onChange={changeFilter} />
      <FacetSelect label="Conjunto" name="packageId" value={draftFilters.packageId} options={facets?.packages ?? []} disabled={attaching} onChange={changeFilter} />
      <div className="library-filter-actions"><button className="button primary" disabled={loading || attaching}>{loading ? 'Buscando…' : 'Aplicar filtros'}</button><button className="button text" type="button" disabled={attaching} onClick={() => { setDraftFilters(emptyFilters); setFilters(emptyFilters); setPage(1); setReload((current) => current + 1); }}>Limpiar</button></div>
    </form>

    {error && <div className="alert error" role="alert">{error} <button type="button" className="link-button" onClick={() => setReload((current) => current + 1)}>Volver a intentar</button></div>}
    <div className="library-workspace">
      <section className="card library-catalog" aria-busy={loading} aria-labelledby="library-results-title">
        <div className="section-heading"><div><h2 id="library-results-title">Documentos de referencia</h2><p>{catalog ? `${catalog.pagination.total} resultado(s)` : 'Catálogo del despacho'}</p></div></div>
        {loading ? <div className="library-state" role="status">Consultando la biblioteca…</div> : !error && catalog?.documents.length === 0 ? <div className="empty library-state"><strong>Sin coincidencias</strong><span>Prueba con otro tipo, materia o término de búsqueda.</span></div> : !error && <div className="library-document-list">
          {catalog?.documents.map((document) => <button type="button" disabled={attaching} aria-pressed={selectedId === document.id} className={`library-document${selectedId === document.id ? ' selected' : ''}`} key={document.id} onClick={() => selectDocument(document, window.matchMedia('(max-width: 1100px)').matches)}>
            <span className="library-file-mark" aria-hidden="true">W</span><span className="library-document-copy"><small>{document.source} · {document.documentTypeLabel}</small><strong>{document.title}</strong><span>{document.packageLabel}</span><span className="library-document-tags"><span>{libraryLabel(document.usage)}</span>{document.duplicateOf && <span>Copia idéntica</span>}</span></span><span className="library-select-arrow" aria-hidden="true">→</span>
          </button>)}
        </div>}
        {catalog && catalog.pagination.totalPages > 1 && <div className="library-pagination"><button type="button" className="button secondary" disabled={loading || attaching || page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</button><span>{catalog.pagination.page} de {catalog.pagination.totalPages}</span><button type="button" className="button secondary" disabled={loading || attaching || page >= catalog.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente</button></div>}
      </section>

      <section className="card library-detail" aria-busy={detailLoading} aria-labelledby="library-detail-title">
        <h2 id="library-detail-title" ref={detailHeading} tabIndex={-1}>{detail?.title ?? 'Consulta del documento'}</h2>
        {(detailLoading || (selectedId && !detail && !detailError)) && <div className="library-state" role="status">Abriendo documento…</div>}
        {detailError && <div className="alert error" role="alert">{detailError} <button type="button" className="link-button" onClick={() => setDetailRetry((current) => current + 1)}>Volver a intentar</button></div>}
        {!selectedId && !loading && <div className="empty library-state"><strong>Selecciona un documento</strong><span>Aquí podrás leer su contenido, revisar observaciones y consultar los archivos relacionados.</span></div>}
        {detail && !detailLoading && !detailError && <>
          <div className="library-detail-tags"><span className="tag">{detail.documentTypeLabel}</span><span className="tag">{libraryLabel(detail.usage)}</span><span className="tag library-preparation">Pendiente de preparación para generar</span></div>
          <dl className="library-metadata"><div><dt>Origen</dt><dd>{detail.source}</dd></div><div><dt>Materia</dt><dd>{facets?.legalFamilies.find((item) => item.value === detail.legalFamily)?.label ?? libraryLabel(detail.legalFamily)}</dd></div><div><dt>Variante</dt><dd>{facets?.variants.find((item) => item.value === detail.variant)?.label ?? libraryLabel(detail.variant)}</dd></div><div><dt>Conjunto</dt><dd>{detail.packageLabel}</dd></div></dl>
          <p className="library-source-path">Ubicación original: {detail.originalPath}</p>
          {(detail.duplicateOf || detail.textEquivalentTo) && <p className="library-equivalence">{detail.duplicateOf ? 'Existe otra copia idéntica en la biblioteca. Se conserva su procedencia.' : 'El texto coincide con otro documento; el formato puede variar.'}</p>}
          <div className="library-detail-actions"><button type="button" className="button secondary" disabled={downloading} onClick={() => void download()}>{downloading ? 'Descargando…' : 'Descargar Word original'}</button><small>{Math.max(1, Math.round(detail.sizeBytes / 1024))} KB</small></div>
          {downloadError && <p className="alert error" role="alert">{downloadError}</p>}

          <ReviewList title="Observaciones del análisis" values={detail.review.notes} />
          <ReviewList title="Preparación pendiente" values={detail.review.blockers} />
          {detail.review.subdocuments.length > 0 && <ReviewList title="Documentos que contiene" values={detail.review.subdocuments.map(libraryLabel)} />}
          {detail.review.fields.length > 0 && <details className="library-disclosure"><summary>Campos por preparar ({detail.review.fields.length})</summary><ul className="library-fields">{detail.review.fields.map((field, index) => <li key={`${index}-${field}`}>{libraryLabel(field)}</li>)}</ul></details>}
          <details className="library-disclosure" open key={`text-${detail.id}`}><summary>Texto del documento</summary><p className="library-text-hint">Consulta del contenido. La descarga conserva el formato del archivo original.</p><div className="library-document-text" tabIndex={0} aria-label="Contenido del documento">{detail.text || 'Este documento no tiene texto disponible para consulta.'}</div></details>

          {related.length > 0 && <section className="library-related"><h3>En el mismo conjunto</h3><div>{related.map((document) => <button type="button" className="library-related-document" disabled={attaching} key={document.id} onClick={() => selectDocument(document)}><span>{document.documentTypeLabel || document.title}</span><small>{document.title}</small></button>)}</div></section>}

          <section className="library-attach" aria-labelledby="library-attach-title"><h3 id="library-attach-title">Agregar como referencia</h3><p>El archivo se incorpora a los documentos del expediente para su consulta. Conserva las observaciones de este modelo.</p>
            {mattersError && <p className="alert error" role="alert">{mattersError} <button type="button" className="link-button" onClick={() => setMattersRetry((current) => current + 1)}>Volver a intentar</button></p>}
            {mattersLoading ? <p role="status">Cargando expedientes…</p> : canAttach ? <form onSubmit={(event) => void attach(event)}>
              <label>Expediente existente<select value={matterId} disabled={attaching || !!mattersError} required onChange={(event) => { setMatterId(event.target.value); setAttachResult(undefined); setAttachError(''); }}><option value="">Selecciona un expediente abierto</option>{matterId && !selectedMatter && <option value={matterId} disabled>{finishedMatter ? `${finishedMatter.reference} · ${finishedMatter.status === 'CLOSED' ? 'Cerrado' : 'Cancelado'}` : 'Expediente no disponible'}</option>}{eligibleMatters.map((matter) => <option value={matter.id} key={matter.id}>{matter.reference} · {matter.title}</option>)}</select></label>
              {finishedMatter && !mattersError && <p className="form-hint" role="status">El expediente {finishedMatter.reference} está {finishedMatter.status === 'CLOSED' ? 'cerrado' : 'cancelado'} y no admite nuevas referencias. Selecciona un expediente abierto para continuar.</p>}
              {!eligibleMatters.length && !mattersError && <p className="form-hint">Necesitas un expediente abierto para agregar una referencia. <Link className="link-button" href="/expedientes">Ver expedientes</Link></p>}
              {related.length > 0 && <label className="library-package-option"><input type="checkbox" checked={includePackage} disabled={attaching} onChange={(event) => { setIncludePackage(event.target.checked); setAttachResult(undefined); }} /><span>Incluir los {related.length + 1} archivos del conjunto <strong>{detail.packageLabel}</strong></span></label>}
              <button className="button primary" disabled={attaching || loading || !selectedMatter || !!mattersError}>{attaching ? 'Agregando referencia…' : includePackage ? 'Agregar conjunto al expediente' : 'Agregar documento al expediente'}</button>
            </form> : role && <p className="form-hint">Tu perfil permite consultar y descargar los documentos. Un integrante con permisos de carga puede agregarlos al expediente.</p>}
            {attachError && <p className="alert error" role="alert">{attachError}</p>}
            {attachResult && attachSummary && <div className={`library-attach-result${attachSummary.failed ? ' partial' : ''}`} role="status"><strong>{attachSummary.attached} agregado(s) · {attachSummary.existing} ya estaban en el expediente{attachSummary.failed ? ` · ${attachSummary.failed} pendiente(s)` : ''}</strong>{attachResult.results.filter((result) => result.status === 'failed').map((result, index) => <p key={`${index}-${result.sourceDocumentId}`}>{result.fileName}: {result.error ?? 'No se pudo agregar. Vuelve a intentarlo.'}</p>)}<Link className="link-button" href={`/expedientes/${encodeURIComponent(attachResult.matterId)}`}>Abrir expediente →</Link></div>}
          </section>
        </>}
      </section>
    </div>
  </div></AppShell>;
}
