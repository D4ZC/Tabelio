'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api';
import './login-mobile.css';

export default function LoginPage() {
  const [email, setEmail] = useState('admin@demo.local');
  const [password, setPassword] = useState('Demo123!');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, organizationSlug: 'demo-despacho' }),
      });
      location.assign(window.matchMedia('(max-width: 760px)').matches ? '/asistente' : '/expedientes');
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
        <div className="story-copy">
          <span className="eyebrow">Tu espacio de trabajo</span>
          <h1>Cada asunto completo, visible y bajo control.</h1>
          <p>Personas, inmuebles, requisitos y documentos reunidos en un solo expediente trazable.</p>
        </div>
        <div className="story-metric"><strong>Una sola captura</strong><span>para contrato y convenio</span></div>
      </section>
      <section className="login-mobile-hero">
        <div className="login-mobile-brand"><span>T</span><strong>Tabelio</strong><small>Legal inmobiliario</small></div>
        <div className="login-mobile-orbit" aria-hidden="true"><span>✦</span></div>
        <div className="login-mobile-copy"><span>Tu espacio de trabajo</span><h1>Tu despacho,<br />a la mano.</h1><p>Consulta, organiza y resuelve con Tabelio IA.</p></div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <span className="eyebrow">Acceso seguro</span>
          <h2>Bienvenido</h2>
          <p>Ingresa al espacio de trabajo del despacho.</p>
          <label htmlFor="login-email">Correo electrónico<input id="login-email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label htmlFor="login-password">Contraseña<span className="login-password-field"><input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{showPassword && <path d="m3 3 18 18" />}</svg></button></span></label>
          <Link className="text-link login-link" href="/recuperar">¿Olvidaste tu contraseña?</Link>
          {error && <div className="alert error" role="alert">{error}</div>}
          <button className="button primary wide login-submit" disabled={loading}>{loading ? 'Ingresando…' : 'Entrar al despacho'}<span aria-hidden="true">→</span></button>
          <small className="form-hint">Las credenciales visibles son únicamente para el entorno local de demostración.</small>
          <div className="login-mobile-footer"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></svg>Tu información, en tu espacio de trabajo.</div>
        </form>
      </section>
    </main>
  );
}
