'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface RecoveryResponse {
  message: string;
  developmentResetUrl?: string;
}

export default function RecoverPasswordPage() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<RecoveryResponse>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      setResult(await apiFetch<RecoveryResponse>('/auth/password-recovery/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }));
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
        <div className="story-copy"><span className="eyebrow">Acceso protegido</span><h1>Recupera el control de tu cuenta.</h1><p>Los enlaces son de un solo uso, caducan en 30 minutos y revocan las sesiones anteriores.</p></div>
        <div className="story-metric"><strong>Sin contraseñas por correo</strong><span>sólo un enlace temporal</span></div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <span className="eyebrow">Recuperación</span>
          <h2>Restablecer acceso</h2>
          <p>Escribe el correo asociado a tu cuenta.</p>
          {!result && <label>Correo<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
          {error && <div className="alert error">{error}</div>}
          {result ? <>
            <div className="alert info">{result.message}</div>
            {result.developmentResetUrl && <a className="button primary wide" href={result.developmentResetUrl}>Abrir enlace local</a>}
            {result.developmentResetUrl && <small className="form-hint">Este acceso directo sólo aparece con el proveedor local de desarrollo.</small>}
          </> : <button className="button primary wide" disabled={loading}>{loading ? 'Preparando…' : 'Solicitar enlace'}</button>}
          <Link className="text-link login-link" href="/login">Volver al inicio de sesión</Link>
        </form>
      </section>
    </main>
  );
}
