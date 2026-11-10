'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './mobile-access.css';

interface LocalConnection { url: string; qrDataUrl: string; certificateUrl?: string; certificateQrDataUrl?: string }

export function MobileAccess() {
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [connections, setConnections] = useState<LocalConnection[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [qrMode, setQrMode] = useState<'app' | 'certificate'>('app');
  const connection = connections[selected];
  const secure = connection?.url.startsWith('https:');
  const displayedUrl = qrMode === 'certificate' ? connection?.certificateUrl : connection?.url;

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    setCopyStatus('');
    setSelected(0);
    setQrMode('app');
    void fetch('/api/local-access', { credentials: 'include', cache: 'no-store', signal: abort.signal })
      .then(async (response) => {
        const data = await response.json() as { connections?: LocalConnection[]; message?: string };
        if (!response.ok) throw new Error(data.message || 'No pudimos preparar el QR.');
        setConnections(data.connections ?? []);
      })
      .catch((cause: unknown) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'No pudimos preparar el QR.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    dialogRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, select') ?? []);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      abort.abort();
      document.removeEventListener('keydown', handleKey);
      triggerRef.current?.focus();
    };
  }, [open]);

  async function copyUrl() {
    if (!displayedUrl) return;
    try {
      await navigator.clipboard.writeText(displayedUrl);
      setCopyStatus('Enlace copiado');
    } catch {
      setCopyStatus('Selecciona el enlace para copiarlo.');
    }
  }

  return <>
    <button ref={triggerRef} type="button" className="mobile-access-trigger" onClick={() => { setPortalTarget(triggerRef.current?.closest('dialog') ?? document.body); setOpen(true); }} aria-haspopup="dialog" aria-expanded={open}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10 5h4m-3 13.5h2" /></svg>
      <span><strong>Llévalo en tu móvil</strong><small>Conecta con un QR</small></span>
      <span className="mobile-access-arrow" aria-hidden="true">↗</span>
    </button>
    {open && portalTarget && createPortal(
      <div className="mobile-access-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="mobile-access-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <button type="button" className="mobile-access-close" aria-label="Cerrar acceso móvil" onClick={() => setOpen(false)}>×</button>
          <span className="mobile-access-kicker">TABELIO EN TU MÓVIL</span>
          <h2 id={titleId}>Tu despacho, contigo.</h2>
          <p>{qrMode === 'certificate' ? 'Descarga el certificado en tu teléfono para habilitar una conexión de confianza.' : 'Escanea el QR con la cámara de tu teléfono y abre Tabelio IA.'}</p>
          {loading ? <div className="mobile-access-placeholder" role="status">Preparando tu código…</div>
            : error ? <div className="mobile-access-error" role="alert">{error}</div>
              : connection ? <>
                {connection.certificateUrl && <div className="mobile-access-tabs" aria-label="Tipo de código QR"><button type="button" className={qrMode === 'app' ? 'active' : ''} aria-pressed={qrMode === 'app'} onClick={() => { setQrMode('app'); setCopyStatus(''); }}>Abrir Tabelio IA</button><button type="button" className={qrMode === 'certificate' ? 'active' : ''} aria-pressed={qrMode === 'certificate'} onClick={() => { setQrMode('certificate'); setCopyStatus(''); }}>Instalar certificado</button></div>}
                <div className="mobile-access-qr"><img src={qrMode === 'certificate' ? connection.certificateQrDataUrl : connection.qrDataUrl} alt={qrMode === 'certificate' ? 'Código QR para descargar el certificado público local' : 'Código QR para abrir Tabelio IA en tu teléfono'} width={222} height={222} /></div>
                {connections.length > 1 && <label className="mobile-access-network">Dirección de red<select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setCopyStatus(''); }}>{connections.map((item, index) => <option key={item.url} value={index}>{new URL(item.url).host}</option>)}</select></label>}
                <div className="mobile-access-url"><input aria-label={qrMode === 'certificate' ? 'Enlace del certificado público' : 'Enlace local de la aplicación'} readOnly value={displayedUrl ?? ''} onFocus={(event) => event.target.select()} /><button type="button" onClick={() => void copyUrl()}>Copiar</button></div>
                <span className="mobile-access-copy-status" role="status">{copyStatus}</span>
                {qrMode === 'certificate' ? <div className="mobile-access-certificate-help"><strong>Una sola vez por teléfono</strong><p>iPhone: instala el perfil y activa la confianza en Ajustes → General → Información → Ajustes de confianza de certificados.</p><p>Android: instala el certificado de CA desde Seguridad → Cifrado y credenciales.</p><a href={connection.certificateUrl} download>Descargar certificado público</a></div> : <div className={`mobile-access-connection ${secure ? 'is-secure' : ''}`}><span aria-hidden="true">{secure ? '✓' : 'i'}</span><div><strong>{secure ? 'Conexión HTTPS' : 'Conexión local HTTP'}</strong><p>{secure ? 'Para dictar, instala y confía en el certificado local una vez en tu teléfono. Después permite el micrófono.' : 'El chat funciona por Wi-Fi. Para usar el micrófono, inicia la app con HTTPS local.'}</p></div></div>}
              </> : <div className="mobile-access-error" role="status">Conecta esta computadora a una red Wi-Fi o Ethernet para generar el QR.</div>}
          <div className="mobile-access-footnote"><strong>En la misma red Wi-Fi</strong><span>Mantén esta computadora encendida. Inicia sesión en tu teléfono con tu cuenta habitual.</span></div>
        </div>
      </div>, portalTarget,
    )}
  </>;
}
