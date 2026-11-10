'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { PublicPortalIntake } from '@/lib/types';

const roleLabels: Record<string, string> = {
  LANDLORD: 'Arrendador/a',
  TENANT: 'Arrendatario/a',
  GUARANTOR: 'Obligado solidario',
  REQUESTING_PARTY: 'Parte solicitante',
  COMPLEMENTARY_PARTY: 'Parte complementaria',
  FACILITATOR: 'Persona facilitadora',
  REPRESENTATIVE: 'Representante',
  OTHER: 'Otra parte',
};

const documentLabels: Record<string, string> = {
  LANDLORD_ID: 'Identificación del arrendador',
  TENANT_ID: 'Identificación del arrendatario',
  GUARANTOR_ID: 'Identificación del obligado solidario',
  TAX_ID: 'Constancia fiscal',
  PROOF_OF_ADDRESS: 'Comprobante de domicilio',
  PROPERTY_TITLE: 'Documento de propiedad',
  GUARANTEE_PROPERTY_TITLE: 'Documento del inmueble en garantía',
  LEASE_ANNEX: 'Contrato o anexo',
  OTHER: 'Otro documento',
};

export default function ClientPortalPage() {
  const token = useParams<{ token: string }>().token;
  const [intake, setIntake] = useState<PublicPortalIntake>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => apiFetch<PublicPortalIntake>(`/portal/intake/${token}`)
    .then(setIntake)
    .catch((cause) => setError((cause as Error).message));

  useEffect(() => { void load(); }, [token]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const raw = Object.fromEntries(new FormData(event.currentTarget));
      const body = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
      setIntake(await apiFetch<PublicPortalIntake>(`/portal/intake/${token}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }));
      setNotice('Información guardada. Puedes agregar documentos y enviar cuando esté completa.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const form = event.currentTarget;
    try {
      await apiFetch(`/portal/intake/${token}/uploads`, { method: 'POST', body: new FormData(form) });
      form.reset();
      await load();
      setNotice('Documento recibido correctamente.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setError(''); setNotice('');
    try {
      setIntake(await apiFetch<PublicPortalIntake>(`/portal/intake/${token}/submit`, { method: 'POST' }));
      setNotice('Información enviada al despacho para revisión.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function removeUpload(uploadId: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiFetch(`/portal/intake/${token}/uploads/${uploadId}`, { method: 'DELETE' });
      await load();
      setNotice('Archivo retirado. Puedes cargar la versión correcta.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  if (!intake) return <main className="portal-page"><div className="portal-loading"><span className="brand-mark">T</span><p>{error || 'Validando invitación segura…'}</p></div></main>;
  const data = intake.submission.personData ?? {};
  const locked = intake.submission.status === 'PENDING_REVIEW' || intake.submission.status === 'ACCEPTED';

  return <main className="portal-page">
    <header className="portal-header">
      <div className="brand light"><span className="brand-mark">T</span><div><strong>Tabelio</strong><small>Portal seguro</small></div></div>
      <span>Enlace válido hasta {new Date(intake.invitation.expiresAt).toLocaleDateString('es-MX')}</span>
    </header>
    <section className="portal-hero">
      <span className="eyebrow">{intake.organizationName}</span>
      <h1>Completa tu información</h1>
      <p>{intake.matter.reference} · {intake.matter.title}</p>
      <div className="portal-role">Participas como <strong>{roleLabels[intake.invitation.partyRole] ?? intake.invitation.partyRole}</strong></div>
    </section>

    <div className="portal-content">
      {intake.submission.status === 'PENDING_REVIEW' && <div className="alert info">Tu información está en revisión. El despacho te avisará si necesita alguna corrección.</div>}
      {intake.submission.status === 'REJECTED' && <div className="alert error"><strong>Se requieren ajustes.</strong> {intake.submission.reviewComment}</div>}
      {notice && <div className="alert info">{notice}</div>}
      {error && <div className="alert error">{error}</div>}

      <form className="card form-card portal-form" onSubmit={save}>
        <div className="section-heading"><div><h2>Datos de la persona</h2><p>La información será revisada antes de integrarse al expediente.</p></div><span className="tag">1 de 2</span></div>
        <div className="form-grid">
          <label>Tipo<select name="type" defaultValue={data.type ?? 'INDIVIDUAL'} disabled={locked}><option value="INDIVIDUAL">Persona física</option><option value="COMPANY">Persona moral</option></select></label>
          <label>Nombre completo o razón social<input name="legalName" required maxLength={240} defaultValue={data.legalName ?? intake.invitation.invitedPersonName ?? ''} disabled={locked} /></label>
          <label>RFC<input name="taxId" maxLength={32} defaultValue={data.taxId ?? ''} disabled={locked} /></label>
          <label>Correo electrónico<input name="email" type="email" defaultValue={data.email ?? intake.invitation.invitedEmail ?? ''} disabled={locked} /></label>
          <label>Teléfono<input name="phone" defaultValue={data.phone ?? ''} disabled={locked} /></label>
          <label>Ocupación<input name="occupation" defaultValue={data.occupation ?? ''} disabled={locked} /></label>
          <label>Nacionalidad<input name="nationality" defaultValue={data.nationality ?? 'Mexicana'} disabled={locked} /></label>
          <label>Estado civil<input name="maritalStatus" defaultValue={data.maritalStatus ?? ''} disabled={locked} /></label>
          <label>Ciudad de nacimiento<input name="birthPlaceCity" defaultValue={data.birthPlaceCity ?? ''} disabled={locked} /></label>
          <label>Estado de nacimiento<input name="birthPlaceState" defaultValue={data.birthPlaceState ?? ''} disabled={locked} /></label>
          <label className="full">Domicilio<input name="addressLine1" defaultValue={data.addressLine1 ?? ''} disabled={locked} /></label>
          <label>Ciudad<input name="city" defaultValue={data.city ?? ''} disabled={locked} /></label>
          <label>Estado<input name="state" defaultValue={data.state ?? ''} disabled={locked} /></label>
          <label>Código postal<input name="postalCode" defaultValue={data.postalCode ?? ''} disabled={locked} /></label>
          <label>Tipo de identificación<input name="identificationType" defaultValue={data.identificationType ?? 'INE'} disabled={locked} /></label>
          <label>Número de identificación<input name="identificationNumber" defaultValue={data.identificationNumber ?? ''} disabled={locked} /></label>
        </div>
        {!locked && <div className="form-actions"><button className="button primary" disabled={busy}>Guardar información</button></div>}
      </form>

      <section className="card form-card portal-form">
        <div className="section-heading"><div><h2>Documentos</h2><p>PDF, Word o imagen. Máximo 20 MB por archivo.</p></div><span className="tag">2 de 2</span></div>
        <div className="portal-upload-list">
          {intake.submission.uploads.map((file) => <article key={file.id}><span className="file-icon">{file.mimeType === 'application/pdf' ? 'PDF' : 'DOC'}</span><div><strong>{file.originalName}</strong><small>{documentLabels[file.type] ?? file.type} · {(file.sizeBytes / 1024).toFixed(0)} KB</small></div>{locked ? <span className="tag">Recibido</span> : <button type="button" className="link-button" disabled={busy} onClick={() => void removeUpload(file.id)}>Retirar</button>}</article>)}
          {intake.submission.uploads.length === 0 && <div className="empty compact"><strong>Sin archivos</strong><span>Agrega al menos tu identificación.</span></div>}
        </div>
        {!locked && <form className="portal-upload-form" onSubmit={upload}>
          <select name="type" required defaultValue={intake.expectedIdentityType ?? 'OTHER'}>{intake.allowedDocumentTypes.map((type) => <option value={type} key={type}>{documentLabels[type] ?? type}</option>)}</select>
          <input name="file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.heic" required />
          <button className="button secondary" disabled={busy}>Cargar</button>
        </form>}
      </section>

      {!locked && <section className="portal-submit"><div><strong>¿Todo listo?</strong><span>Primero guarda tus datos y comprueba que la identificación aparezca como recibida.</span></div><button className="button primary" disabled={busy} onClick={() => void submit()}>Enviar a revisión</button></section>}
    </div>
    <footer className="portal-footer">La información sólo será accesible para el despacho responsable del expediente.</footer>
  </main>;
}
