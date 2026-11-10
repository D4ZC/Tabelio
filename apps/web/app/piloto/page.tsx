'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { AdministrationBreadcrumb } from '@/components/administration-breadcrumb';
import { apiFetch, downloadFromApi } from '@/lib/api';
import type { PilotReadiness } from '@/lib/types';

const technicalStatusLabels = {
  PASS: 'Correcto',
  WARNING: 'Advertencia',
  BLOCKED: 'Bloqueante',
};

export default function PilotPage() {
  const [readiness, setReadiness] = useState<PilotReadiness>();
  const [role, setRole] = useState('');
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const canManage = role === 'ADMIN';

  async function load() {
    setError('');
    try {
      const session = await apiFetch<{ role: string }>('/auth/me');
      setRole(session.role);
      if (session.role !== 'ADMIN') return;
      setReadiness(await apiFetch<PilotReadiness>('/pilot/readiness'));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => { void load(); }, []);

  async function complete(code: string) {
    const value = evidence[code]?.trim() ?? '';
    if (value.length < 10) {
      setError('Describe la evidencia de la comprobación con al menos 10 caracteres.');
      return;
    }
    setBusy(code); setError(''); setMessage('');
    try {
      await apiFetch(`/pilot/checkpoints/${encodeURIComponent(code)}/complete`, {
        method: 'POST',
        body: JSON.stringify({ evidence: value }),
      });
      setEvidence((current) => ({ ...current, [code]: '' }));
      setMessage('Comprobación completada y registrada en auditoría.');
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function reopen(code: string) {
    const reason = window.prompt('Indica el motivo de reapertura (mínimo 10 caracteres):')?.trim();
    if (!reason) return;
    if (reason.length < 10) {
      setError('El motivo de reapertura debe tener al menos 10 caracteres.');
      return;
    }
    setBusy(code); setError(''); setMessage('');
    try {
      await apiFetch(`/pilot/checkpoints/${encodeURIComponent(code)}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setMessage('Comprobación reabierta y registrada en auditoría.');
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function exportDiagnosis() {
    setExporting(true); setError('');
    try {
      await downloadFromApi('/pilot/readiness.csv', `preparacion-piloto-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return <AppShell allowedRoles={['ADMIN']}>
    <AdministrationBreadcrumb current="Prueba inicial" />
    <header className="page-header pilot-header">
      <div><span className="eyebrow">Prepara al equipo</span><h1>Prueba inicial</h1><p>Comprueba los datos, la capacitación y los respaldos antes de empezar con un grupo pequeño.</p></div>
      <div className="pilot-header-actions">
        {readiness && <span className={`pilot-verdict ${readiness.readyForPilot ? 'ready' : 'not-ready'}`}><i />{readiness.readyForPilot ? 'Listo para la prueba' : 'Aún no listo'}</span>}
        {canManage && <button className="button secondary" disabled={exporting} onClick={() => void exportDiagnosis()}>{exporting ? 'Exportando…' : 'Exportar diagnóstico'}</button>}
        <Link className="button primary" href="/piloto/operacion">Participantes y seguimiento</Link>
      </div>
    </header>

    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert success">{message}</div>}

    {!readiness ? <div className="page-loader">Evaluando preparación…</div> : <>
      <section className="metric-row pilot-metrics">
        <article className={readiness.summary.blockers ? 'metric-card pilot-danger' : 'metric-card accent'}><span>Bloqueantes</span><strong>{readiness.summary.blockers}</strong><small>deben resolverse antes de iniciar</small></article>
        <article className="metric-card"><span>Advertencias</span><strong>{readiness.summary.warnings}</strong><small>riesgos aceptables con mitigación</small></article>
        <article className="metric-card"><span>Controles superados</span><strong>{readiness.summary.passed}</strong><small>técnicos y operativos</small></article>
        <article className="metric-card"><span>Comprobaciones</span><strong>{readiness.summary.manualCompleted}/{readiness.summary.manualTotal}</strong><small>evidencias registradas</small></article>
      </section>

      <section className={`card pilot-decision ${readiness.readyForPilot ? 'ready' : 'not-ready'}`}>
        <span>{readiness.readyForPilot ? '✓' : '!'}</span>
        <div><h2>{readiness.readyForPilot ? 'El despacho puede iniciar la prueba' : 'Hay pendientes antes de iniciar'}</h2><p>{readiness.readyForPilot ? 'Los bloqueantes técnicos y las comprobaciones operativas están resueltos. Las advertencias quedan visibles para seguimiento.' : `Faltan ${readiness.summary.blockers} control(es) bloqueante(s). Las advertencias no impiden avanzar, pero deben contar con mitigación.`}</p></div>
      </section>

      <div className="pilot-grid">
        <section className="card pilot-checkpoints">
          <div className="section-heading"><div><h2>Comprobaciones operativas</h2><p>Cada confirmación exige evidencia y conserva responsable, fecha y auditoría.</p></div><span className="tag">{readiness.summary.manualCompleted}/{readiness.summary.manualTotal}</span></div>
          <div className="pilot-checkpoint-list">{readiness.checkpoints.map((checkpoint) => <article key={checkpoint.code} className={checkpoint.status === 'COMPLETE' ? 'complete' : 'pending'}>
            <span className="pilot-check-icon">{checkpoint.status === 'COMPLETE' ? '✓' : '○'}</span>
            <div className="pilot-check-copy">
              <strong>{checkpoint.label}</strong>
              <p>{checkpoint.description}</p>
              {checkpoint.status === 'COMPLETE' ? <div className="pilot-evidence"><span>{checkpoint.evidence}</span><small>{checkpoint.completedBy?.displayName} · {checkpoint.completedAt ? new Date(checkpoint.completedAt).toLocaleString('es-MX') : ''}</small></div> : canManage ? <label>Evidencia<textarea rows={3} minLength={10} maxLength={2000} value={evidence[checkpoint.code] ?? ''} onChange={(event) => setEvidence((current) => ({ ...current, [checkpoint.code]: event.target.value }))} placeholder="Acta, muestra revisada, fecha de capacitación, prueba realizada…" /></label> : <div className="pilot-pending-note">Pendiente de confirmación administrativa.</div>}
            </div>
            {canManage && <div className="pilot-check-actions">{checkpoint.status === 'COMPLETE'
              ? <button className="link-button danger" disabled={busy === checkpoint.code} onClick={() => void reopen(checkpoint.code)}>Reabrir</button>
              : <button className="button primary" disabled={busy === checkpoint.code || (evidence[checkpoint.code]?.trim().length ?? 0) < 10} onClick={() => void complete(checkpoint.code)}>{busy === checkpoint.code ? 'Guardando…' : 'Confirmar'}</button>}
            </div>}
          </article>)}</div>
        </section>

        <section className="card pilot-technical">
          <div className="section-heading"><div><h2>Diagnóstico técnico</h2><p>Lectura actual del entorno y la carga operativa.</p></div><button className="link-button" onClick={() => void load()}>Actualizar</button></div>
          <div className="pilot-technical-list">{readiness.technicalChecks.map((check) => <article key={check.code} className={`pilot-${check.status.toLowerCase()}`}>
            <span />
            <div><strong>{check.label}</strong><p>{check.detail}</p></div>
            <em>{technicalStatusLabels[check.status]}</em>
          </article>)}</div>
          <p className="pilot-generated">Última evaluación: {new Date(readiness.generatedAt).toLocaleString('es-MX')}</p>
        </section>
      </div>
    </>}
  </AppShell>;
}
