'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(location.search).get('token') ?? '');
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmation) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setLoading(true);
    try {
      await apiFetch('/auth/password-recovery/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      });
      setComplete(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand light"><span className="brand-mark">T</span><div><strong>Tabelio</strong><small>Legal inmobiliario</small></div></div>
        <div className="story-copy"><span className="eyebrow">Nueva contraseña</span><h1>Una llave nueva para tu expediente.</h1><p>Al guardar el cambio, todas las sesiones abiertas anteriormente dejarán de ser válidas.</p></div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <span className="eyebrow">Enlace temporal</span>
          <h2>{complete ? 'Acceso actualizado' : 'Crea tu contraseña'}</h2>
          {complete ? <>
            <div className="alert info">La contraseña cambió y las sesiones anteriores fueron revocadas.</div>
            <Link className="button primary wide" href="/login">Iniciar sesión</Link>
          </> : <>
            <p>Usa al menos 10 caracteres, una mayúscula, una minúscula y un número.</p>
            {!token && <div className="alert error">El enlace no contiene un token de recuperación.</div>}
            <label>Nueva contraseña<input type="password" required minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label>Confirmar contraseña<input type="password" required minLength={10} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            {error && <div className="alert error">{error}</div>}
            <button className="button primary wide" disabled={loading || !token}>{loading ? 'Guardando…' : 'Guardar contraseña'}</button>
            <Link className="text-link login-link" href="/recuperar">Solicitar otro enlace</Link>
          </>}
        </form>
      </section>
    </main>
  );
}
