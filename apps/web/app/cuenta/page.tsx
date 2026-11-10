'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { apiFetch } from '@/lib/api';

export default function AccountPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmation) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setLoading(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setComplete(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <header className="page-header"><div><span className="eyebrow">Seguridad</span><h1>Mi cuenta</h1><p>Actualiza tus credenciales de acceso.</p></div></header>
      <section className="card form-card narrow">
        <div className="section-heading"><h2>Cambiar contraseña</h2><p>El cambio cerrará todas tus sesiones abiertas, incluida ésta.</p></div>
        {complete ? <>
          <div className="alert info">Contraseña actualizada. Inicia sesión nuevamente.</div>
          <Link className="button primary" href="/login">Ir al inicio de sesión</Link>
        </> : <form onSubmit={submit}>
          <div className="form-grid">
            <label className="full">Contraseña actual<input type="password" required minLength={8} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
            <label>Nueva contraseña<input type="password" required minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label>Confirmar contraseña<input type="password" required minLength={10} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          </div>
          <small className="form-hint">Mínimo 10 caracteres, con mayúscula, minúscula y número.</small>
          {error && <div className="alert error">{error}</div>}
          <div className="form-actions"><button className="button primary" disabled={loading}>{loading ? 'Guardando…' : 'Cambiar contraseña'}</button></div>
        </form>}
      </section>
    </AppShell>
  );
}
