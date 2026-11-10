'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';
import type { MatterDetail, MatterSummary, Property, TaskAssignee } from '@/lib/types';

export default function NewMatterPage() {
  const router = useRouter();
  const [kind, setKind] = useState<'LEASE' | 'MEDIATION_AGREEMENT'>('LEASE');
  const [title, setTitle] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [linkedMatterId, setLinkedMatterId] = useState('');
  const [properties, setProperties] = useState<Property[]>([]);
  const [leases, setLeases] = useState<MatterSummary[]>([]);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [responsibleMembershipId, setResponsibleMembershipId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<Property[]>('/properties'),
      apiFetch<MatterSummary[]>('/matters'),
      apiFetch<TaskAssignee[]>('/tasks/assignees'),
    ])
      .then(([propertyData, matterData, assigneeData]) => {
        setProperties(propertyData);
        setLeases(matterData.filter((matter) => matter.kind === 'LEASE'));
        setAssignees(assigneeData.filter((assignee) => ['ADMIN', 'LAWYER', 'OPERATOR'].includes(assignee.role)));
      })
      .catch((cause) => setError((cause as Error).message));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const matter = await apiFetch<MatterDetail>('/matters', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          title,
          propertyId: propertyId || undefined,
          responsibleMembershipId: responsibleMembershipId || undefined,
          linkedMatterId: kind === 'MEDIATION_AGREEMENT' ? linkedMatterId || undefined : undefined,
        }),
      });
      router.push(`/expedientes/${matter.id}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <header className="page-header compact"><div><span className="eyebrow">Alta guiada</span><h1>Nuevo expediente</h1><p>El checklist se construirá automáticamente según el tipo de asunto.</p></div></header>
      <form className="card form-card narrow" onSubmit={submit}>
        <div className="step-marker"><span>1</span><div><strong>Datos iniciales</strong><small>Podrás completar personas, condiciones y documentos después.</small></div></div>
        <fieldset className="choice-grid">
          <label className={kind === 'LEASE' ? 'choice selected' : 'choice'}>
            <input type="radio" checked={kind === 'LEASE'} onChange={() => setKind('LEASE')} />
            <span>⌂</span><strong>Arrendamiento</strong><small>Contrato, partes, inmueble y condiciones económicas.</small>
          </label>
          <label className={kind === 'MEDIATION_AGREEMENT' ? 'choice selected' : 'choice'}>
            <input type="radio" checked={kind === 'MEDIATION_AGREEMENT'} onChange={() => setKind('MEDIATION_AGREEMENT')} />
            <span>§</span><strong>Convenio de mediación</strong><small>Relacionado con un contrato de arrendamiento.</small>
          </label>
        </fieldset>
        <div className="form-grid">
          <label className="full">Nombre del asunto<input required placeholder="Ej. Arrendamiento Casa Providencia" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="full">Inmueble<select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}><option value="">Asignar después</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.displayName} — {property.city}</option>)}</select></label>
          <label className="full">Responsable<select value={responsibleMembershipId} onChange={(event) => setResponsibleMembershipId(event.target.value)}><option value="">Usuario actual</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.user.displayName} — {assignee.role}</option>)}</select></label>
          {kind === 'MEDIATION_AGREEMENT' && <label className="full">Contrato relacionado<select required value={linkedMatterId} onChange={(event) => setLinkedMatterId(event.target.value)}><option value="">Selecciona el arrendamiento</option>{leases.map((matter) => <option key={matter.id} value={matter.id}>{matter.reference} — {matter.title}</option>)}</select></label>}
        </div>
        {properties.length === 0 && <div className="alert info">No hay inmuebles registrados. Puedes crear el expediente y asignarlo después desde el Directorio.</div>}
        {error && <div className="alert error">{error}</div>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => router.back()}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Creando…' : 'Crear expediente'}</button></div>
      </form>
    </AppShell>
  );
}
