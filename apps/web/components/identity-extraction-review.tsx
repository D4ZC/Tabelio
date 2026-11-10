'use client';

import { useEffect, useState } from 'react';
import { apiFetch, blobFromApi } from '@/lib/api';
import { IDENTITY_FIELDS, IDENTITY_FIELD_LABELS, initialIdentityValues, personIdentityValue, type IdentityField } from '@/lib/identity-review';
import { extractedDocumentText } from '@/lib/assistant-documents';
import type { ExtractionQueueResponse, Person } from '@/lib/types';

type ExtractionRun = ExtractionQueueResponse['runs'][number];

export function IdentityExtractionReview({ run, people, onReviewed }: {
  run: ExtractionRun;
  people: Person[];
  onReviewed: (message: string) => Promise<void>;
}) {
  const [values, setValues] = useState(() => initialIdentityValues(run.rawData));
  const [personId, setPersonId] = useState(run.document.person?.id ?? '');
  const person = run.document.person ?? people.find((candidate) => candidate.id === personId);
  const [selected, setSelected] = useState<IdentityField[]>(() => IDENTITY_FIELDS.filter((field) => (
    Boolean(run.rawData?.[field]) && !personIdentityValue(run.document.person, field)
  )));
  const [overwrite, setOverwrite] = useState<IdentityField[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    if (!showOriginal) return;
    let cancelled = false;
    let objectUrl = '';
    setPreviewError('');
    void blobFromApi(`/documents/${run.document.id}/download`).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) setPreviewError('No se pudo abrir la vista previa. Puedes descargar el original.');
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [showOriginal, run.document.id]);

  function changeValue(field: IdentityField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setOverwrite((current) => current.filter((key) => key !== field));
    if (!value.trim()) setSelected((current) => current.filter((key) => key !== field));
  }

  function changePerson(value: string) {
    setPersonId(value);
    setOverwrite([]);
    const nextPerson = people.find((candidate) => candidate.id === value);
    setSelected(IDENTITY_FIELDS.filter((field) => values[field].trim() && !personIdentityValue(nextPerson, field)));
  }

  function isReplacement(field: IdentityField) {
    const current = personIdentityValue(person, field);
    return Boolean(current && current !== values[field].trim());
  }

  const missingOverwrite = selected.some((field) => isReplacement(field) && !overwrite.includes(field));
  const originalText = extractedDocumentText(run.rawData);
  const hasData = Boolean(originalText) || IDENTITY_FIELDS.some((field) => values[field].trim());

  async function save(rejected = false) {
    setError('');
    if (!rejected && selected.length && !person) {
      setError('Selecciona la persona relacionada. Si todavía no existe, regístrala en Directorio y vuelve a esta revisión.');
      return;
    }
    if (!rejected && missingOverwrite) {
      setError('Confirma por separado los datos existentes que deseas reemplazar.');
      return;
    }
    setBusy(true);
    try {
      const data = Object.fromEntries(IDENTITY_FIELDS.flatMap((field) => values[field].trim() ? [[field, values[field].trim()]] : []));
      if (originalText) data.extractedText = originalText;
      const edited = IDENTITY_FIELDS.some((field) => values[field].trim() !== String(run.rawData?.[field] ?? '').trim());
      const result = await apiFetch<{ appliedPersonFields?: string[] }>(`/documents/${run.document.id}/extractions/${run.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision: rejected ? 'REJECTED' : edited ? 'CORRECTED' : 'CONFIRMED',
          comment: comment.trim(),
          ...(!rejected ? {
            data,
            ...(selected.length ? {
              personId: person?.id,
              personFields: selected,
              overwritePersonFields: overwrite.filter((field) => selected.includes(field)),
              expectedPersonValues: Object.fromEntries(selected.map((field) => [field, personIdentityValue(person, field)])),
            } : {}),
          } : {}),
        }),
      });
      const count = result.appliedPersonFields?.length ?? 0;
      await onReviewed(rejected ? 'Extracción rechazada. La ficha no se modificó.'
        : count ? `Revisión guardada. Se actualizaron ${count} campo(s) de la ficha seleccionada.`
          : 'Revisión guardada en el documento. La ficha de la persona no se modificó.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="identity-review">
    <div className="identity-review-intro"><div><h3>Revisar datos de la identificación</h3><p>Compara con el original y selecciona qué campos guardar en la ficha. Los datos existentes no se reemplazan sin tu autorización.</p></div><button type="button" className="button secondary" onClick={() => { setPreviewUrl(''); setShowOriginal((current) => !current); }}>{showOriginal ? 'Ocultar original' : 'Ver original'}</button></div>
    {showOriginal && <div className="identity-original">{previewError ? <p role="alert">{previewError}</p> : !previewUrl ? <p>Cargando original…</p> : run.document.mimeType === 'application/pdf' ? <iframe title={`Identificación original: ${run.document.originalName}`} src={previewUrl} /> : <img src={previewUrl} alt="Identificación original para comparar con los datos extraídos" />}</div>}
    {originalText && <label className="extracted-document-text">Texto leído · selecciona para copiar<textarea readOnly rows={10} value={originalText} onFocus={(event) => event.currentTarget.select()} /><span>La lectura local conserva el texto; captura y verifica los campos que quieras guardar en la ficha.</span></label>}
    <label className="identity-person">Persona cuya ficha se actualizará<select value={personId} disabled={busy || Boolean(run.document.person)} onChange={(event) => changePerson(event.target.value)}><option value="">Selecciona una persona física</option>{run.document.person && !people.some((candidate) => candidate.id === run.document.person?.id) && <option value={run.document.person.id}>{run.document.person.legalName}</option>}{people.filter((candidate) => candidate.type === 'INDIVIDUAL').map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.legalName}</option>)}</select></label>
    {!person && <p className="form-hint">Puedes registrar primero a la persona en Directorio o desmarcar todos los campos para conservar únicamente la revisión del documento.</p>}
    <div className="identity-fields">{IDENTITY_FIELDS.map((field) => <div className="identity-field" key={field}>
      <label className="identity-field-value">{IDENTITY_FIELD_LABELS[field]}<input type={field === 'birthDate' ? 'date' : 'text'} value={values[field]} maxLength={field === 'curp' ? 18 : 300} placeholder="Sin información legible" disabled={busy} onChange={(event) => changeValue(field, event.target.value)} /></label>
      <div className="identity-current"><small>Actual en la ficha</small><span>{personIdentityValue(person, field) || 'Sin capturar'}</span></div>
      <div className="identity-field-choice"><label><input type="checkbox" checked={selected.includes(field)} disabled={busy || !values[field].trim()} onChange={(event) => setSelected((current) => event.target.checked ? [...current, field] : current.filter((key) => key !== field))} />Guardar en ficha</label>{selected.includes(field) && isReplacement(field) && <label className="identity-overwrite"><input type="checkbox" checked={overwrite.includes(field)} disabled={busy} onChange={(event) => setOverwrite((current) => event.target.checked ? [...current, field] : current.filter((key) => key !== field))} />Autorizo reemplazar el dato existente</label>}</div>
    </div>)}</div>
    <label className="identity-comment">Comentario de revisión<textarea rows={3} minLength={10} maxLength={2000} value={comment} disabled={busy} onChange={(event) => setComment(event.target.value)} placeholder="Indica cómo verificaste los datos contra la identificación…" /></label>
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="identity-review-actions"><button type="button" className="button primary" disabled={busy || comment.trim().length < 10 || !hasData || missingOverwrite || (selected.length > 0 && !person)} onClick={() => void save()}>{busy ? 'Guardando revisión…' : selected.length ? 'Confirmar y guardar campos seleccionados' : 'Guardar revisión sin modificar ficha'}</button><button type="button" className="button secondary" disabled={busy || comment.trim().length < 10} onClick={() => void save(true)}>Rechazar extracción</button></div>
    <p className="form-hint">La lectura automática puede equivocarse y no verifica la autenticidad ni la vigencia de la INE. Los campos que desmarques no modificarán la ficha.</p>
  </div>;
}
