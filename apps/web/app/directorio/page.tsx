'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import type { Person, Property } from '@/lib/types';

export default function DirectoryPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tab, setTab] = useState<'people' | 'properties'>('people');
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [editingPerson, setEditingPerson] = useState<Person>();
  const [editingProperty, setEditingProperty] = useState<Property>();

  function load() {
    Promise.all([apiFetch<Person[]>('/people'), apiFetch<Property[]>('/properties')])
      .then(([personData, propertyData]) => { setPeople(personData); setProperties(propertyData); })
      .catch((cause) => setError((cause as Error).message));
  }

  useEffect(load, []);

  const filteredPeople = useMemo(
    () => people.filter((person) => matchesSearch(person, search)),
    [people, search],
  );
  const filteredProperties = useMemo(
    () => properties.filter((property) => matchesSearch(property, search)),
    [properties, search],
  );
  const visibleRecords = tab === 'people' ? filteredPeople : filteredProperties;
  const totalRecords = tab === 'people' ? people.length : properties.length;
  // Con miles de registros importados se limita lo que se pinta; la búsqueda acota el resto.
  const RENDER_LIMIT = 200;

  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = Object.fromEntries(new FormData(form));
    const data = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
    try {
      await apiFetch(editingPerson ? `/people/${editingPerson.id}` : '/people', {
        method: editingPerson ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...data, type: 'INDIVIDUAL' }),
      });
      form.reset(); setShowForm(false); setEditingPerson(undefined); load();
    } catch (cause) { setError((cause as Error).message); }
  }

  async function createProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = Object.fromEntries(new FormData(form));
    const data = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
    try {
      await apiFetch(editingProperty ? `/properties/${editingProperty.id}` : '/properties', {
        method: editingProperty ? 'PATCH' : 'POST',
        body: JSON.stringify(data),
      });
      form.reset(); setShowForm(false); setEditingProperty(undefined); load();
    } catch (cause) { setError((cause as Error).message); }
  }

  return (
    <AppShell>
      <header className="page-header">
        <div><span className="eyebrow">Fuentes maestras</span><h1>Directorio</h1><p>Captura una vez y reutiliza personas e inmuebles en todos los asuntos.</p></div>
        <button className="button primary" onClick={() => { setEditingPerson(undefined); setEditingProperty(undefined); setShowForm(!showForm); }}>＋ {tab === 'people' ? 'Nueva persona' : 'Nuevo inmueble'}</button>
      </header>
      <div className="tabs"><button className={tab === 'people' ? 'active' : ''} onClick={() => { setTab('people'); setShowForm(false); }}>Personas <span>{filteredPeople.length}</span></button><button className={tab === 'properties' ? 'active' : ''} onClick={() => { setTab('properties'); setShowForm(false); }}>Inmuebles <span>{filteredProperties.length}</span></button></div>
      <div className="directory-toolbar">
        <label className="directory-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Buscar en el Directorio"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={120}
            placeholder="Buscar por nombre, RFC, correo, teléfono, domicilio…"
          />
          {search && <button type="button" aria-label="Limpiar búsqueda" onClick={() => setSearch('')}>×</button>}
        </label>
        <small>{search.trim()
          ? `${visibleRecords.length} de ${totalRecords} registro(s)`
          : `${totalRecords} registro(s)`}</small>
      </div>
      {error && <div className="alert error">{error}</div>}

      {showForm && tab === 'people' && (
        <form className="card form-card" key={editingPerson?.id ?? 'new-person'} onSubmit={createPerson}>
          <div className="section-heading"><div><h2>{editingPerson ? 'Editar persona' : 'Nueva persona'}</h2><p>Los campos ampliados permiten completar contrato y convenio sin recaptura.</p></div></div>
          <div className="form-grid three">
            <label className="full">Nombre legal<input name="legalName" required defaultValue={editingPerson?.legalName} /></label>
            <label>Nombre(s)<input name="givenName" defaultValue={editingPerson?.givenName} /></label><label>Apellidos<input name="familyName" defaultValue={editingPerson?.familyName} /></label><label>Género / tratamiento<input name="gender" placeholder="Señora, señor…" defaultValue={editingPerson?.gender} /></label>
            <label>Nacionalidad<input name="nationality" defaultValue={editingPerson?.nationality ?? 'Mexicana'} /></label><label>RFC<input name="taxId" defaultValue={editingPerson?.taxId} /></label><label>Ocupación<input name="occupation" defaultValue={editingPerson?.occupation} /></label>
            <label>Estado civil<input name="maritalStatus" defaultValue={editingPerson?.maritalStatus} /></label><label>Correo<input name="email" type="email" defaultValue={editingPerson?.email} /></label><label>Teléfono<input name="phone" defaultValue={editingPerson?.phone} /></label>
            <label className="full">Domicilio<input name="addressLine1" defaultValue={editingPerson?.addressLine1} /></label><label>Ciudad<input name="city" defaultValue={editingPerson?.city} /></label><label>Estado<input name="state" defaultValue={editingPerson?.state ?? 'Jalisco'} /></label><label>Código postal<input name="postalCode" defaultValue={editingPerson?.postalCode} /></label>
            <label>Identificación<input name="identificationType" placeholder="INE, pasaporte…" defaultValue={editingPerson?.identificationType} /></label><label>Número de identificación<input name="identificationNumber" defaultValue={editingPerson?.identificationNumber} /></label>
            <label>CURP<input name="curp" maxLength={18} defaultValue={editingPerson?.curp} /></label>
          </div>
          <div className="form-actions"><button type="button" className="button secondary" onClick={() => { setShowForm(false); setEditingPerson(undefined); }}>Cancelar</button><button className="button primary">{editingPerson ? 'Actualizar persona' : 'Guardar persona'}</button></div>
        </form>
      )}

      {showForm && tab === 'properties' && (
        <form className="card form-card" key={editingProperty?.id ?? 'new-property'} onSubmit={createProperty}>
          <div className="section-heading"><div><h2>{editingProperty ? 'Editar inmueble' : 'Nuevo inmueble'}</h2><p>Puede ser el bien arrendado o el ofrecido en garantía.</p></div></div>
          <div className="form-grid three">
            <label>Nombre corto<input name="displayName" required placeholder="Casa Providencia" defaultValue={editingProperty?.displayName} /></label><label>Uso<input name="useType" defaultValue={editingProperty?.useType ?? 'Casa habitación'} /></label><label>Propietario<select name="ownerPersonId" defaultValue={editingProperty?.ownerPersonId ?? ''}><option value="">Sin asignar</option>{people.map((person) => <option value={person.id} key={person.id}>{person.legalName}</option>)}</select></label>
            <label className="full">Domicilio<input name="addressLine1" required defaultValue={editingProperty?.addressLine1} /></label><label>Colonia<input name="neighborhood" defaultValue={editingProperty?.neighborhood} /></label><label>Ciudad<input name="city" required defaultValue={editingProperty?.city ?? 'Guadalajara'} /></label><label>Estado<input name="state" required defaultValue={editingProperty?.state ?? 'Jalisco'} /></label>
            <label>Código postal<input name="postalCode" defaultValue={editingProperty?.postalCode} /></label><label>Referencia registral<input name="registryReference" defaultValue={editingProperty?.registryReference} /></label><label>Acreditación de propiedad<input name="ownershipEvidence" placeholder="Escritura pública…" defaultValue={editingProperty?.ownershipEvidence} /></label>
          </div>
          <div className="form-actions"><button type="button" className="button secondary" onClick={() => { setShowForm(false); setEditingProperty(undefined); }}>Cancelar</button><button className="button primary">{editingProperty ? 'Actualizar inmueble' : 'Guardar inmueble'}</button></div>
        </form>
      )}

      <section className="card directory-grid">
        {tab === 'people' ? filteredPeople.slice(0, RENDER_LIMIT).map((person) => (
          <article className="directory-item" key={person.id}><div className="avatar large">{person.legalName.slice(0, 1)}</div><div><strong>{person.legalName}</strong><span>{person.taxId || 'RFC pendiente'}</span><small>{person.email || person.phone || 'Sin contacto capturado'}</small></div><div className="directory-actions"><span className="tag">{person.type === 'COMPANY' ? 'Persona moral' : 'Persona física'}</span><button className="link-button" onClick={() => { setEditingPerson(person); setShowForm(true); scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button></div></article>
        )) : filteredProperties.slice(0, RENDER_LIMIT).map((property) => (
          <article className="directory-item" key={property.id}><div className="property-icon">⌂</div><div><strong>{property.displayName}</strong><span>{property.addressLine1}</span><small>{property.city}, {property.state} · {property.useType}</small></div><div className="directory-actions"><span className="tag">{property.owner?.legalName || 'Propietario pendiente'}</span><button className="link-button" onClick={() => { setEditingProperty(property); setShowForm(true); scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button></div></article>
        ))}
        {visibleRecords.length > RENDER_LIMIT && <div className="empty compact"><strong>Mostrando {RENDER_LIMIT} de {visibleRecords.length.toLocaleString('es-MX')}</strong><span>Escribe un nombre, RFC o domicilio para acotar los resultados.</span></div>}
        {visibleRecords.length === 0 && <div className="empty"><strong>{search.trim() ? 'Sin coincidencias' : 'No hay registros'}</strong><span>{search.trim() ? 'Prueba con otro nombre, correo, RFC, teléfono o dato del registro.' : 'Agrega el primero para reutilizarlo en un expediente.'}</span></div>}
      </section>
    </AppShell>
  );
}

function matchesSearch(record: unknown, query: string) {
  const terms = normalizeSearch(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const searchable = normalizeSearch(flattenSearchableValues(record));
  return terms.every((term) => searchable.includes(term));
}

function flattenSearchableValues(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(flattenSearchableValues).join(' ');
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(flattenSearchableValues).join(' ');
  }
  return String(value);
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-MX')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
