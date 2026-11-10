'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import type { RequirementDefinition } from '@/lib/types';

type MatterKind = RequirementDefinition['matterKind'];

const kindLabels: Record<MatterKind, string> = {
  LEASE: 'Arrendamiento',
  MEDIATION_AGREEMENT: 'Convenio',
};

const roleLabels: Record<string, string> = {
  LANDLORD: 'Arrendador/a',
  TENANT: 'Arrendatario/a',
  GUARANTOR: 'Obligado solidario',
  REQUESTING_PARTY: 'Parte solicitante',
  COMPLEMENTARY_PARTY: 'Parte complementaria',
};

const rolesByKind: Record<MatterKind, string[]> = {
  LEASE: ['LANDLORD', 'TENANT', 'GUARANTOR'],
  MEDIATION_AGREEMENT: ['REQUESTING_PARTY', 'COMPLEMENTARY_PARTY', 'GUARANTOR'],
};

export default function RequirementsPage() {
  const [matterKind, setMatterKind] = useState<MatterKind>('LEASE');
  const [requirements, setRequirements] = useState<RequirementDefinition[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load(kind = matterKind) {
    setRequirements(await apiFetch<RequirementDefinition[]>(`/requirements?matterKind=${kind}`));
  }

  useEffect(() => {
    apiFetch<{ role: string }>('/auth/me')
      .then((session) => setIsAdmin(session.role === 'ADMIN'))
      .catch((cause) => setError((cause as Error).message));
  }, []);

  useEffect(() => {
    setError('');
    load(matterKind).catch((cause) => setError((cause as Error).message));
  }, [matterKind]);

  const metrics = useMemo(() => ({
    active: requirements.filter((item) => item.active).length,
    blocking: requirements.filter((item) => item.active && item.blocking).length,
    manual: requirements.filter((item) => item.active && item.completionMode === 'MANUAL').length,
  }), [requirements]);

  async function createRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError('');
    try {
      await apiFetch('/requirements', {
        method: 'POST',
        body: JSON.stringify({
          code: String(data.get('code') ?? ''),
          label: String(data.get('label') ?? ''),
          matterKind,
          blocking: data.get('blocking') === 'on',
          appliesToRole: String(data.get('appliesToRole') ?? '') || undefined,
          sortOrder: data.get('sortOrder') ? Number(data.get('sortOrder')) : undefined,
        }),
      });
      form.reset(); setShowForm(false); await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function updateRequirement(requirement: RequirementDefinition, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      await apiFetch(`/requirements/${requirement.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          label: String(data.get('label') ?? ''),
          blocking: data.get('blocking') === 'on',
          appliesToRole: String(data.get('appliesToRole') ?? '') || null,
          sortOrder: Number(data.get('sortOrder')),
        }),
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function toggleRequirement(requirement: RequirementDefinition) {
    setBusy(true); setError('');
    try {
      await apiFetch(`/requirements/${requirement.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !requirement.active }),
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <header className="page-header">
        <div><span className="eyebrow">Configuración operativa</span><h1>Requisitos</h1><p>Define el checklist que recibirá cada expediente nuevo.</p></div>
        {isAdmin && <button className="button primary" onClick={() => setShowForm(!showForm)}>＋ Nuevo requisito</button>}
      </header>

      <div className="tabs requirement-tabs">
        {(Object.keys(kindLabels) as MatterKind[]).map((kind) => <button type="button" className={matterKind === kind ? 'active' : ''} key={kind} onClick={() => setMatterKind(kind)}>{kindLabels[kind]} <span>{kind === matterKind ? requirements.length : ''}</span></button>)}
      </div>

      <section className="metric-row">
        <article className="metric-card accent"><span>Activos</span><strong>{metrics.active}</strong><small>se copiarán al próximo expediente</small></article>
        <article className="metric-card"><span>Bloqueantes</span><strong>{metrics.blocking}</strong><small>impiden avanzar si están pendientes</small></article>
        <article className="metric-card"><span>Confirmación manual</span><strong>{metrics.manual}</strong><small>requieren intervención del equipo</small></article>
      </section>

      {error && <div className="alert error">{error}</div>}

      {showForm && isAdmin && <form className="card form-card" onSubmit={createRequirement}>
        <div className="section-heading"><div><h2>Agregar requisito</h2><p>Los requisitos personalizados se confirman manualmente dentro del expediente.</p></div></div>
        <div className="form-grid three">
          <label>Código<input name="code" required minLength={2} maxLength={40} pattern="[A-Za-z0-9_-]+" placeholder="ENTREGA_LLAVES" /></label>
          <label className="span-two">Etiqueta<input name="label" required minLength={3} maxLength={180} placeholder="Confirmar entrega de llaves" /></label>
          <label>Rol aplicable<select name="appliesToRole" defaultValue=""><option value="">Expediente general</option>{rolesByKind[matterKind].map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
          <label>Orden<input name="sortOrder" type="number" min="0" max="10000" placeholder="Automático" /></label>
          <label className="requirement-checkbox"><input name="blocking" type="checkbox" defaultChecked /> Bloquea el avance</label>
        </div>
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => setShowForm(false)}>Cancelar</button><button className="button primary" disabled={busy}>Guardar requisito</button></div>
      </form>}

      <section className="card requirement-catalog">
        <div className="section-heading"><div><h2>Checklist de {kindLabels[matterKind].toLowerCase()}</h2><p>Los cambios aplican sólo a expedientes creados posteriormente.</p></div>{!isAdmin && <span className="tag">Sólo lectura</span>}</div>
        <div className="requirement-list">
          {requirements.map((requirement) => isAdmin ? <form className={`requirement-row ${requirement.active ? '' : 'inactive'}`} key={requirement.id} onSubmit={(event) => void updateRequirement(requirement, event)}>
            <div className="requirement-order"><input aria-label="Orden" name="sortOrder" type="number" min="0" max="10000" defaultValue={requirement.sortOrder} key={`${requirement.id}-${requirement.sortOrder}`} /></div>
            <div className="requirement-copy"><small>{requirement.code}</small><input aria-label="Etiqueta" name="label" required minLength={3} maxLength={180} defaultValue={requirement.label} key={`${requirement.id}-${requirement.label}`} /></div>
            <select aria-label="Rol aplicable" name="appliesToRole" defaultValue={requirement.appliesToRole ?? ''} key={`${requirement.id}-${requirement.appliesToRole}`}><option value="">General</option>{rolesByKind[matterKind].map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>
            <label className="requirement-checkbox compact"><input name="blocking" type="checkbox" defaultChecked={requirement.blocking} key={`${requirement.id}-${requirement.blocking}`} /> Bloqueante</label>
            <div className="requirement-tags"><span className={`tag requirement-${requirement.completionMode.toLowerCase()}`}>{requirement.completionMode === 'AUTO' ? 'Automático' : 'Manual'}</span><span className={`tag ${requirement.active ? 'requirement-active' : 'requirement-inactive'}`}>{requirement.active ? 'Activo' : 'Inactivo'}</span></div>
            <div className="requirement-actions"><button className="button secondary" disabled={busy}>Guardar</button><button className="button text" type="button" disabled={busy} onClick={() => void toggleRequirement(requirement)}>{requirement.active ? 'Desactivar' : 'Activar'}</button></div>
          </form> : <article className={`requirement-row readonly ${requirement.active ? '' : 'inactive'}`} key={requirement.id}>
            <strong className="requirement-order">{requirement.sortOrder}</strong>
            <div className="requirement-copy"><small>{requirement.code}</small><strong>{requirement.label}</strong></div>
            <span>{requirement.appliesToRole ? roleLabels[requirement.appliesToRole] : 'General'}</span>
            <span>{requirement.blocking ? 'Bloqueante' : 'Recomendado'}</span>
            <div className="requirement-tags"><span className={`tag requirement-${requirement.completionMode.toLowerCase()}`}>{requirement.completionMode === 'AUTO' ? 'Automático' : 'Manual'}</span><span className={`tag ${requirement.active ? 'requirement-active' : 'requirement-inactive'}`}>{requirement.active ? 'Activo' : 'Inactivo'}</span></div>
          </article>)}
          {requirements.length === 0 && <div className="empty"><strong>Sin requisitos</strong><span>Agrega el primer requisito para este tipo de expediente.</span></div>}
        </div>
      </section>
    </AppShell>
  );
}
