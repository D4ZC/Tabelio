'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { AdministrationBreadcrumb } from '@/components/administration-breadcrumb';
import { apiFetch, downloadFromApi } from '@/lib/api';
import type { MatterSummary, PilotOperations, TaskAssignee } from '@/lib/types';

const programLabels = {
  DRAFT: 'Borrador', READY: 'Listo', ACTIVE: 'En ejecución', PAUSED: 'Pausado', COMPLETED: 'Completado',
};
const resultLabels = { PENDING: 'Pendiente', MATCH: 'Coincide', MISMATCH: 'Diferencia' };
const severityLabels = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', CRITICAL: 'Crítica' };

const importExample = JSON.stringify([
  {
    type: 'INDIVIDUAL',
    legalName: 'Persona de ejemplo',
    taxId: 'RFC-DE-EJEMPLO',
    email: 'persona@example.test',
    city: 'Guadalajara',
    state: 'Jalisco',
  },
], null, 2);

export default function PilotOperationsPage() {
  const [data, setData] = useState<PilotOperations>();
  const [role, setRole] = useState('');
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [programName, setProgramName] = useState('');
  const [targetCases, setTargetCases] = useState(10);
  const [participantMembershipId, setParticipantMembershipId] = useState('');
  const [trainingDrafts, setTrainingDrafts] = useState<Record<string, string>>({});
  const [validationMatterId, setValidationMatterId] = useState('');
  const [legacyReference, setLegacyReference] = useState('');
  const [validationDrafts, setValidationDrafts] = useState<Record<string, { result: 'MATCH' | 'MISMATCH'; notes: string }>>({});
  const [sourceName, setSourceName] = useState('Migración inicial');
  const [importJson, setImportJson] = useState(importExample);
  const [issue, setIssue] = useState({ category: 'Operación', severity: 'MEDIUM', title: '', description: '', matterId: '', assignedMembershipId: '' });

  const canManage = role === 'ADMIN';

  async function load() {
    setError('');
    try {
      const session = await apiFetch<{ role: string }>('/auth/me');
      setRole(session.role);
      if (session.role !== 'ADMIN') return;
      const [operations, availableAssignees, availableMatters] = await Promise.all([
        apiFetch<PilotOperations>('/pilot/operations'),
        apiFetch<TaskAssignee[]>('/tasks/assignees'),
        apiFetch<MatterSummary[]>('/matters?view=options'),
      ]);
      setData(operations);
      setAssignees(availableAssignees);
      setMatters(availableMatters);
      setProgramName(operations.program.name);
      setTargetCases(operations.program.targetCases);
      setValidationDrafts((current) => {
        const next = { ...current };
        for (const item of operations.validations) {
          if (!next[item.id]) next[item.id] = { result: 'MATCH', notes: '' };
        }
        return next;
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => { void load(); }, []);

  async function mutate(path: string, method: 'POST' | 'PATCH', body: unknown, success: string) {
    setBusy(path); setError(''); setMessage('');
    try {
      await apiFetch(path, { method, body: JSON.stringify(body) });
      setMessage(success);
      await load();
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setBusy('');
    }
  }

  async function saveProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate('/pilot/program', 'PATCH', { name: programName.trim(), targetCases }, 'Configuración del piloto actualizada.');
  }

  async function transition(status: PilotOperations['program']['status'], rolloutPercentage?: number) {
    const comment = window.prompt('Comentario obligatorio para la transición:')?.trim();
    if (!comment) return;
    await mutate('/pilot/program/transition', 'POST', { status, rolloutPercentage, comment }, 'Estado del piloto actualizado.');
  }

  async function startCycle() {
    if (!program) return;
    const suggestedName = `${program.name.replace(/ · Ciclo \d+$/, '')} · Ciclo ${data.history.length + 2}`;
    const name = window.prompt('Nombre del nuevo ciclo:', suggestedName)?.trim();
    if (!name) return;
    const reason = window.prompt('Motivo y objetivo del nuevo ciclo:')?.trim();
    if (!reason) return;
    await mutate('/pilot/program/cycles', 'POST', {
      name,
      targetCases: program.targetCases,
      reason,
    }, 'Nuevo ciclo creado; el anterior quedó preservado en el historial.');
  }

  async function addParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate('/pilot/participants', 'POST', { membershipId: participantMembershipId }, 'Participante agregado a la prueba.')) {
      setParticipantMembershipId('');
    }
  }

  async function confirmTraining(id: string) {
    const evidence = trainingDrafts[id]?.trim() ?? '';
    if (await mutate(`/pilot/participants/${id}/training`, 'POST', { evidence }, 'Capacitación confirmada con evidencia.')) {
      setTrainingDrafts((current) => ({ ...current, [id]: '' }));
    }
  }

  async function removeParticipant(id: string) {
    const reason = window.prompt('Motivo para retirar al participante:')?.trim();
    if (!reason) return;
    await mutate(`/pilot/participants/${id}/remove`, 'POST', { reason }, 'Participante retirado de la prueba.');
  }

  async function addValidation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate('/pilot/validations', 'POST', { matterId: validationMatterId, legacyReference: legacyReference.trim() || undefined }, 'Caso agregado a la operación paralela.')) {
      setValidationMatterId(''); setLegacyReference('');
    }
  }

  async function reviewValidation(id: string) {
    const draft = validationDrafts[id];
    if (!draft) return;
    await mutate(`/pilot/validations/${id}/review`, 'POST', draft, 'Conciliación registrada.');
  }

  async function previewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let people: unknown;
    try {
      people = JSON.parse(importJson);
      if (!Array.isArray(people)) throw new Error();
    } catch {
      setError('La migración debe ser un arreglo JSON válido.');
      return;
    }
    await mutate('/pilot/imports/preview', 'POST', { sourceName: sourceName.trim(), people }, 'Vista previa de migración creada.');
  }

  async function createIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      ...issue,
      matterId: issue.matterId || undefined,
      assignedMembershipId: issue.assignedMembershipId || undefined,
    };
    if (await mutate('/pilot/issues', 'POST', payload, 'Incidencia registrada.')) {
      setIssue((current) => ({ ...current, title: '', description: '' }));
    }
  }

  async function resolveIssue(id: string) {
    const resolution = window.prompt('Describe la corrección aplicada:')?.trim();
    if (!resolution) return;
    await mutate(`/pilot/issues/${id}`, 'PATCH', { status: 'RESOLVED', resolution }, 'Incidencia resuelta.');
  }

  async function exportOperations() {
    setBusy('export'); setError('');
    try {
      await downloadFromApi('/pilot/operations.csv', `operacion-piloto-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  const program = data?.program;
  const activeMembershipIds = new Set(data?.participants.filter((item) => item.status === 'ACTIVE').map((item) => item.membership.id));
  const availableParticipants = assignees.filter((item) => !activeMembershipIds.has(item.id) && item.role !== 'VIEWER');
  const validatedMatterIds = new Set(data?.validations.map((item) => item.matter.id));

  return <AppShell allowedRoles={['ADMIN']}>
    <AdministrationBreadcrumb current="Seguimiento de la prueba" />
    <header className="page-header pilot-ops-header">
      <div><span className="eyebrow">Prueba inicial</span><h1>Seguimiento de la prueba</h1><p>Organiza a los participantes, revisa los expedientes y resuelve incidencias antes de ampliar el uso.</p></div>
      <div className="pilot-header-actions"><Link className="button secondary" href="/piloto">← Preparación</Link>{canManage && <button className="button secondary" disabled={busy === 'export'} onClick={() => void exportOperations()}>Exportar operación</button>}</div>
    </header>
    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert success">{message}</div>}

    {!data || !program ? <div className="page-loader">Preparando operación…</div> : <>
      <section className="card pilot-program-card">
        <div className="pilot-program-status"><span className={`pilot-status-dot status-${program.status.toLowerCase()}`} /><div><span>Programa</span><h2>{program.name}</h2><small>{programLabels[program.status]} · adopción {program.rolloutPercentage}% · muestra {program.targetCases} caso(s)</small></div></div>
        <div className="pilot-rollout"><div><i style={{ width: `${program.rolloutPercentage}%` }} /></div><strong>{program.rolloutPercentage}%</strong></div>
        {canManage && <div className="pilot-transition-actions">
          {program.status === 'DRAFT' && <button className="button primary" onClick={() => void transition('READY')}>Marcar listo</button>}
          {program.status === 'READY' && <><button className="button secondary" onClick={() => void transition('DRAFT')}>Volver a borrador</button><button className="button primary" onClick={() => void transition('ACTIVE', 10)}>Iniciar al 10%</button></>}
          {program.status === 'ACTIVE' && <><button className="button secondary" onClick={() => void transition('PAUSED')}>Pausar</button>{[25, 50, 100].filter((step, index, steps) => step > program.rolloutPercentage && (index === 0 || steps[index - 1] <= program.rolloutPercentage)).slice(0, 1).map((step) => <button className="button primary" key={step} onClick={() => void transition('ACTIVE', step)}>Avanzar a {step}%</button>)}{program.rolloutPercentage === 100 && <button className="button primary" onClick={() => void transition('COMPLETED')}>Cerrar prueba</button>}</>}
          {program.status === 'PAUSED' && <><button className="button primary" onClick={() => void transition('ACTIVE', program.rolloutPercentage || 10)}>Reanudar</button>{program.rolloutPercentage === 100 && <button className="button primary" onClick={() => void transition('COMPLETED')}>Cerrar prueba</button>}</>}
          {program.status === 'COMPLETED' && <button className="button primary" onClick={() => void startCycle()}>Iniciar nuevo ciclo</button>}
        </div>}
      </section>

      <section className="metric-row pilot-ops-metrics">
        <article className="metric-card"><span>Participantes</span><strong>{data.gates.counts.activeParticipants}</strong><small>{data.gates.counts.untrainedParticipants} sin capacitación</small></article>
        <article className="metric-card"><span>Conciliados</span><strong>{data.gates.counts.matchedValidations}/{program.targetCases}</strong><small>{data.gates.counts.mismatches} diferencia(s)</small></article>
        <article className="metric-card"><span>Migraciones</span><strong>{data.gates.counts.committedImports}</strong><small>lotes confirmados</small></article>
        <article className={data.gates.counts.seriousIssues ? 'metric-card pilot-danger' : 'metric-card accent'}><span>Incidencias serias</span><strong>{data.gates.counts.seriousIssues}</strong><small>altas o críticas abiertas</small></article>
      </section>

      <section className="card pilot-gates-panel"><div className="section-heading"><div><h2>Requisitos para avanzar</h2><p>Resuelve los bloqueos antes de iniciar o cerrar la prueba.</p></div><span className={`tag ${data.gates.ready ? 'pilot-gate-ready' : 'pilot-gate-blocked'}`}>{data.gates.ready ? 'Todas superadas' : `${data.gates.blockers} bloqueante(s)`}</span></div><div className="pilot-gates-list">{data.gates.checks.map((gate) => <article key={gate.code} className={gate.status.toLowerCase()}><span>{gate.status === 'PASS' ? '✓' : '!'}</span><div><strong>{gate.label}</strong><small>{gate.detail}</small></div></article>)}</div></section>

      {data.history.length > 0 && <section className="card pilot-history-panel"><div className="section-heading"><div><h2>Historial de ciclos</h2><p>Ciclos cerrados preservados como evidencia; nunca se reutilizan ni sobrescriben.</p></div><span className="tag">{data.history.length}</span></div><div className="pilot-history-list">{data.history.map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{programLabels[item.status]} · {item.rolloutPercentage}% · muestra {item.targetCases}</small></div><time>{new Date(item.completedAt ?? item.createdAt).toLocaleDateString('es-MX')}</time></article>)}</div></section>}

      {canManage && program.status !== 'COMPLETED' && <form className="card pilot-config-form" onSubmit={saveProgram}><div className="section-heading"><div><h2>Configuración</h2><p>Fija el nombre y la muestra antes de iniciar.</p></div></div><label>Nombre<input value={programName} minLength={3} maxLength={120} onChange={(event) => setProgramName(event.target.value)} required /></label><label>Casos objetivo<input type="number" min={1} max={500} value={targetCases} onChange={(event) => setTargetCases(Number(event.target.value))} required /></label><button className="button secondary" disabled={Boolean(busy)}>Guardar</button></form>}

      <div className="pilot-ops-grid">
        <section className="card pilot-cohort-panel"><div className="section-heading"><div><h2>Participantes y capacitación</h2><p>Participantes limitados y evidencia individual.</p></div><span className="tag">{data.participants.filter((item) => item.status === 'ACTIVE').length}</span></div>
          {canManage && program.status !== 'COMPLETED' && <form className="pilot-inline-form" onSubmit={addParticipant}><select value={participantMembershipId} onChange={(event) => setParticipantMembershipId(event.target.value)} required><option value="">Selecciona integrante</option>{availableParticipants.map((item) => <option key={item.id} value={item.id}>{item.user.displayName} · {item.role}</option>)}</select><button className="button secondary">Agregar</button></form>}
          <div className="pilot-cohort-list">{data.participants.length === 0 ? <div className="empty compact">Sin participantes.</div> : data.participants.map((item) => <article key={item.id} className={item.status === 'REMOVED' ? 'removed' : ''}><div className="avatar">{item.membership.user.displayName.slice(0, 1)}</div><div><strong>{item.membership.user.displayName}</strong><small>{item.membership.role} · {item.status === 'REMOVED' ? 'Retirado' : item.trainedAt ? 'Capacitado' : 'Capacitación pendiente'}</small>{item.trainingEvidence && <p>{item.trainingEvidence}</p>}{canManage && item.status === 'ACTIVE' && !item.trainedAt && <div className="pilot-training-form"><input value={trainingDrafts[item.id] ?? ''} minLength={10} maxLength={2000} onChange={(event) => setTrainingDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Evidencia de capacitación" /><button className="link-button" disabled={(trainingDrafts[item.id]?.trim().length ?? 0) < 10} onClick={() => void confirmTraining(item.id)}>Confirmar</button></div>}</div>{canManage && item.status === 'ACTIVE' && <button className="link-button danger" onClick={() => void removeParticipant(item.id)}>Retirar</button>}</article>)}</div>
        </section>

        <section className="card pilot-import-panel"><div className="section-heading"><div><h2>Importación de datos</h2><p>Revisa los datos y corrige los errores antes de confirmar la importación.</p></div><span className="tag">{data.imports.length}</span></div>
          {canManage && ['DRAFT', 'READY'].includes(program.status) && <form className="pilot-import-form" onSubmit={previewImport}><label>Fuente<input value={sourceName} minLength={3} maxLength={180} onChange={(event) => setSourceName(event.target.value)} required /></label><label>Personas en JSON<textarea rows={9} value={importJson} onChange={(event) => setImportJson(event.target.value)} spellCheck={false} required /></label><button className="button secondary">Validar sin importar</button></form>}
          <div className="pilot-import-list">{data.imports.map((item) => <article key={item.id}><div><strong>{item.sourceName}</strong><small>{item.totalRows} fila(s) · {item.validRows} válida(s) · {item.invalidRows} error(es)</small></div><span className={`tag import-${item.status.toLowerCase()}`}>{item.status}</span>{item.validation.some((row) => !row.valid) && <div className="pilot-import-errors">{item.validation.filter((row) => !row.valid).map((row) => <p key={row.row}>Fila {row.row}: {row.errors.join(', ')}</p>)}</div>}{canManage && item.status === 'READY' && <button className="button primary" onClick={() => void mutate(`/pilot/imports/${item.id}/commit`, 'POST', {}, 'Lote importado de forma atómica.')}>Confirmar importación</button>}</article>)}</div>
        </section>

        <section className="card pilot-validation-panel"><div className="section-heading"><div><h2>Comparación con el proceso anterior</h2><p>Conciliación contra el proceso anterior por expediente.</p></div><span className="tag">{data.validations.length}</span></div>
          {canManage && program.status !== 'COMPLETED' && <form className="pilot-validation-form" onSubmit={addValidation}><select value={validationMatterId} onChange={(event) => setValidationMatterId(event.target.value)} required><option value="">Selecciona expediente</option>{matters.filter((item) => !validatedMatterIds.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.reference} · {item.title}</option>)}</select><input value={legacyReference} maxLength={120} onChange={(event) => setLegacyReference(event.target.value)} placeholder="Referencia anterior (opcional)" /><button className="button secondary">Agregar caso</button></form>}
          <div className="pilot-validation-list">{data.validations.map((item) => <article key={item.id} className={`result-${item.result.toLowerCase()}`}><div><strong>{item.matter.reference} · {item.matter.title}</strong><small>{item.legacyReference ? `Anterior: ${item.legacyReference} · ` : ''}{resultLabels[item.result]}</small>{item.notes && <p>{item.notes}</p>}</div>{canManage && item.result === 'PENDING' ? <div className="pilot-validation-review"><select value={validationDrafts[item.id]?.result ?? 'MATCH'} onChange={(event) => setValidationDrafts((current) => ({ ...current, [item.id]: { result: event.target.value as 'MATCH' | 'MISMATCH', notes: current[item.id]?.notes ?? '' } }))}><option value="MATCH">Coincide</option><option value="MISMATCH">Diferencia</option></select><input value={validationDrafts[item.id]?.notes ?? ''} minLength={10} maxLength={3000} onChange={(event) => setValidationDrafts((current) => ({ ...current, [item.id]: { result: current[item.id]?.result ?? 'MATCH', notes: event.target.value } }))} placeholder="Conclusión de la comparación" /><button className="link-button" disabled={(validationDrafts[item.id]?.notes.trim().length ?? 0) < 10} onClick={() => void reviewValidation(item.id)}>Registrar</button></div> : <span className={`tag result-${item.result.toLowerCase()}`}>{resultLabels[item.result]}</span>}</article>)}</div>
        </section>

        <section className="card pilot-issues-panel"><div className="section-heading"><div><h2>Correcciones y soporte</h2><p>Incidencias con severidad, responsable y resolución.</p></div><span className="tag">{data.issues.filter((item) => ['OPEN', 'IN_PROGRESS'].includes(item.status)).length} abiertas</span></div>
          {canManage && program.status !== 'COMPLETED' && <form className="pilot-issue-form" onSubmit={createIssue}><input value={issue.category} minLength={2} maxLength={80} onChange={(event) => setIssue((current) => ({ ...current, category: event.target.value }))} placeholder="Categoría" required /><select value={issue.severity} onChange={(event) => setIssue((current) => ({ ...current, severity: event.target.value }))}>{Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={issue.title} minLength={5} maxLength={180} onChange={(event) => setIssue((current) => ({ ...current, title: event.target.value }))} placeholder="Título" required /><textarea rows={3} value={issue.description} minLength={10} maxLength={5000} onChange={(event) => setIssue((current) => ({ ...current, description: event.target.value }))} placeholder="Descripción y reproducción" required /><select value={issue.assignedMembershipId} onChange={(event) => setIssue((current) => ({ ...current, assignedMembershipId: event.target.value }))}><option value="">Sin responsable</option>{assignees.map((item) => <option key={item.id} value={item.id}>{item.user.displayName}</option>)}</select><select value={issue.matterId} onChange={(event) => setIssue((current) => ({ ...current, matterId: event.target.value }))}><option value="">Sin expediente</option>{matters.map((item) => <option key={item.id} value={item.id}>{item.reference}</option>)}</select><button className="button secondary">Registrar incidencia</button></form>}
          <div className="pilot-issue-list">{data.issues.map((item) => <article key={item.id} className={`severity-${item.severity.toLowerCase()}`}><span>{severityLabels[item.severity]}</span><div><strong>{item.title}</strong><small>{item.category} · {item.status} · {item.assignedMembership?.user.displayName ?? 'Sin responsable'}</small><p>{item.resolution ?? item.description}</p></div>{canManage && ['OPEN', 'IN_PROGRESS'].includes(item.status) && <button className="link-button" onClick={() => void resolveIssue(item.id)}>Resolver</button>}</article>)}</div>
        </section>
      </div>
    </>}
  </AppShell>;
}
