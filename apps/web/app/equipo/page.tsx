'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';

interface Member {
  id: string;
  role: 'ADMIN' | 'LAWYER' | 'OPERATOR' | 'VIEWER';
  createdAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    active: boolean;
    createdAt: string;
  };
}

const roleLabels = {
  ADMIN: 'Administrador',
  LAWYER: 'Abogado',
  OPERATOR: 'Operador',
  VIEWER: 'Consulta',
};

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [canManage, setCanManage] = useState(false);

  async function load() {
    try {
      setMembers(await apiFetch<Member[]>('/members'));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    apiFetch<{ role: string }>('/auth/me')
      .then((session) => setCanManage(session.role === 'ADMIN'))
      .catch((cause) => setError((cause as Error).message));
    void load();
  }, []);

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError('');
    try {
      await apiFetch('/members', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      form.reset(); setShowForm(false); await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(memberId: string, role: Member['role']) {
    setBusy(true); setError('');
    try {
      await apiFetch(`/members/${memberId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <header className="page-header">
        <div><span className="eyebrow">Acceso y responsabilidades</span><h1>Equipo</h1><p>Administra quién puede capturar, revisar, aprobar o consultar.</p></div>
        {canManage && <button className="button primary" onClick={() => setShowForm(!showForm)}>＋ Nuevo integrante</button>}
      </header>
      <section className="metric-row">
        <article className="metric-card accent"><span>Integrantes activos</span><strong>{members.filter((member) => member.user.active).length}</strong><small>en esta organización</small></article>
        <article className="metric-card"><span>Perfiles jurídicos</span><strong>{members.filter((member) => ['ADMIN', 'LAWYER'].includes(member.role)).length}</strong><small>pueden avanzar y dispensar</small></article>
        <article className="metric-card"><span>Consulta</span><strong>{members.filter((member) => member.role === 'VIEWER').length}</strong><small>sin permisos de escritura</small></article>
      </section>
      {error && <div className="alert error">{error}</div>}

      {showForm && <form className="card form-card" onSubmit={createMember}>
        <div className="section-heading"><div><h2>Nuevo integrante</h2><p>En este MVP la contraseña temporal se entrega fuera del sistema.</p></div></div>
        <div className="form-grid">
          <label>Nombre<input name="displayName" required minLength={2} /></label>
          <label>Correo<input name="email" type="email" required /></label>
          <label>Rol<select name="role" defaultValue="OPERATOR">{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Contraseña temporal<input name="temporaryPassword" type="password" required minLength={10} /><small className="form-hint">Mayúscula, minúscula y número.</small></label>
        </div>
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => setShowForm(false)}>Cancelar</button><button className="button primary" disabled={busy}>Crear acceso</button></div>
      </form>}

      <section className="card table-card">
        <div className="card-toolbar"><div><h2>Integrantes</h2><p>{members.length} cuenta(s) vinculadas</p></div></div>
        <div className="team-list">
          {members.map((member) => <article key={member.id}>
            <div className="avatar large">{member.user.displayName.slice(0, 1)}</div>
            <div><strong>{member.user.displayName}</strong><span>{member.user.email}</span><small>Desde {new Date(member.createdAt).toLocaleDateString('es-MX')}</small></div>
            <select disabled={busy || !canManage} value={member.role} onChange={(event) => void updateRole(member.id, event.target.value as Member['role'])}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <span className={member.user.active ? 'availability active' : 'availability'}>{member.user.active ? 'Activo' : 'Inactivo'}</span>
          </article>)}
          {members.length === 0 && <div className="empty"><strong>Sin integrantes visibles</strong><span>Agrega una cuenta para comenzar.</span></div>}
        </div>
      </section>
    </AppShell>
  );
}
