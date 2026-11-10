'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { StatusPill } from '@/components/status-pill';
import { apiFetch, downloadFromApi } from '@/lib/api';
import type { GlobalSearchResponse } from '@/lib/types';

const kindLabels = { LEASE: 'Arrendamiento', MEDIATION_AGREEMENT: 'Convenio' };
const documentLabels: Record<string, string> = {
  LANDLORD_ID: 'Identificación del arrendador', TENANT_ID: 'Identificación del arrendatario',
  GUARANTOR_ID: 'Identificación del obligado solidario', TAX_ID: 'Constancia fiscal',
  PROOF_OF_ADDRESS: 'Comprobante de domicilio', PROPERTY_TITLE: 'Acreditación de propiedad',
  GUARANTEE_PROPERTY_TITLE: 'Acreditación de garantía', LEASE_ANNEX: 'Contrato / Anexo 1',
  DRAFT_CONTRACT: 'Borrador contractual', DRAFT_CONTRACT_PDF: 'Vista previa PDF',
  SIGNED_CONTRACT: 'Contrato firmado', TERMINATION_EVIDENCE: 'Evidencia de terminación', OTHER: 'Otro',
};

export function SearchClient({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GlobalSearchResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function runSearch(value: string) {
    const normalized = value.trim();
    if (normalized.length < 2) {
      setResults(undefined);
      return;
    }
    setLoading(true); setError('');
    try {
      setResults(await apiFetch<GlobalSearchResponse>(`/search?q=${encodeURIComponent(normalized)}&limit=8`));
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    setQuery(initialQuery);
    void runSearch(initialQuery);
  }, [initialQuery]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2) {
      setError('Escribe al menos dos caracteres.');
      return;
    }
    router.replace(`/buscar?q=${encodeURIComponent(normalized)}`);
    void runSearch(normalized);
  }

  async function download(documentId: string, name: string) {
    setError('');
    try {
      await downloadFromApi(`/documents/${documentId}/download`, name);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const hasResults = Boolean(results?.resultCount);

  return (
    <AppShell>
      <header className="page-header compact search-header">
        <div><span className="eyebrow">Consulta transversal</span><h1>Buscar</h1><p>Encuentra expedientes, personas, inmuebles y documentos de tu organización.</p></div>
      </header>
      <form className="global-search-form" onSubmit={submit}>
        <span>⌕</span>
        <input autoFocus value={query} minLength={2} maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder="Referencia, nombre, RFC, domicilio o archivo…" />
        <button className="button primary" disabled={loading}>{loading ? 'Buscando…' : 'Buscar'}</button>
      </form>
      {error && <div className="alert error">{error}</div>}

      {!initialQuery && !results && <div className="card search-welcome"><span>⌕</span><strong>Una consulta para toda la operación</strong><p>Busca por referencia de expediente, nombre, RFC, correo, domicilio, referencia registral o nombre de archivo.</p></div>}
      {results && <div className="search-summary"><strong>{results.resultCount}</strong> resultado(s) mostrados para “{results.query}”</div>}
      {results && !hasResults && <div className="card empty"><strong>Sin coincidencias</strong><span>Prueba con otra referencia, nombre o domicilio.</span></div>}

      {results && hasResults && <div className="search-results">
        {results.matters.items.length > 0 && <section className="card search-group">
          <div className="section-heading"><div><h2>Expedientes</h2><p>{kindLabels.LEASE} y {kindLabels.MEDIATION_AGREEMENT.toLowerCase()}</p></div><span className="tag">{results.matters.items.length}{results.matters.hasMore ? '+' : ''}</span></div>
          <div className="search-result-list">{results.matters.items.map((matter) => <Link className="search-result" href={`/expedientes/${matter.id}`} key={matter.id}>
            <span className="search-result-icon">▤</span><div><small>{matter.reference} · {kindLabels[matter.kind]}</small><strong>{matter.title}</strong><p>{matter.property ? `${matter.property.displayName} · ${matter.property.city}, ${matter.property.state}` : 'Sin inmueble asociado'}{matter.responsible ? ` · ${matter.responsible.user.displayName}` : ''}</p></div><StatusPill status={matter.status} />
          </Link>)}</div>
        </section>}

        {results.people.items.length > 0 && <section className="card search-group">
          <div className="section-heading"><div><h2>Personas</h2><p>Datos del directorio y expedientes relacionados.</p></div><span className="tag">{results.people.items.length}{results.people.hasMore ? '+' : ''}</span></div>
          <div className="search-result-list">{results.people.items.map((person) => <article className="search-result" key={person.id}>
            <span className="search-result-icon avatar-search">{person.legalName.slice(0, 1)}</span><div><small>{person.type === 'COMPANY' ? 'Persona moral' : 'Persona física'} · {person.taxId ?? 'RFC pendiente'}</small><strong>{person.legalName}</strong><p>{person.email ?? person.phone ?? 'Sin contacto capturado'}</p>{person.matterParties.length > 0 && <div className="search-related">{person.matterParties.map(({ matter }) => <Link key={matter.id} href={`/expedientes/${matter.id}`}>{matter.reference}</Link>)}</div>}</div><Link className="link-button" href="/directorio">Ver directorio</Link>
          </article>)}</div>
        </section>}

        {results.properties.items.length > 0 && <section className="card search-group">
          <div className="section-heading"><div><h2>Inmuebles</h2><p>Domicilios y asuntos vinculados.</p></div><span className="tag">{results.properties.items.length}{results.properties.hasMore ? '+' : ''}</span></div>
          <div className="search-result-list">{results.properties.items.map((property) => <article className="search-result" key={property.id}>
            <span className="search-result-icon">⌂</span><div><small>{property.useType} · {property.owner?.legalName ?? 'Propietario pendiente'}</small><strong>{property.displayName}</strong><p>{property.addressLine1}, {property.city}, {property.state}</p>{(property.matters.length > 0 || property.guaranteeFor.length > 0) && <div className="search-related">{[...property.matters, ...property.guaranteeFor].filter((matter, index, all) => all.findIndex((candidate) => candidate.id === matter.id) === index).map((matter) => <Link key={matter.id} href={`/expedientes/${matter.id}`}>{matter.reference}</Link>)}</div>}</div><Link className="link-button" href="/directorio">Ver directorio</Link>
          </article>)}</div>
        </section>}

        {results.documents.items.length > 0 && <section className="card search-group">
          <div className="section-heading"><div><h2>Documentos</h2><p>Archivos versionados del repositorio.</p></div><span className="tag">{results.documents.items.length}{results.documents.hasMore ? '+' : ''}</span></div>
          <div className="search-result-list">{results.documents.items.map((document) => <article className="search-result" key={document.id}>
            <span className="search-result-icon file-search">{document.mimeType === 'application/pdf' ? 'PDF' : 'DOC'}</span><div><small>{documentLabels[document.type] ?? document.type} · versión {document.version}</small><strong>{document.originalName}</strong><p>{document.matter ? `${document.matter.reference} · ${document.matter.title}` : document.person?.legalName ?? document.property?.displayName ?? 'Repositorio general'}</p></div><div className="search-result-actions">{document.matter && <Link className="link-button" href={`/expedientes/${document.matter.id}`}>Abrir expediente</Link>}<button type="button" className="link-button" onClick={() => void download(document.id, document.originalName)}>Descargar</button></div>
          </article>)}</div>
        </section>}
      </div>}
    </AppShell>
  );
}
