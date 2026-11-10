'use client';

import { FormEvent, useId, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';

const PROTECTED_DOCUMENT_TYPES = new Set(['DRAFT_CONTRACT', 'DRAFT_CONTRACT_PDF', 'SIGNED_CONTRACT', 'TERMINATION_EVIDENCE']);

export function DeleteDocumentButton({ document, matterStatus, disabled, onBusyChange, onDeleted, onError }: {
  document: { id: string; type: string; originalName: string; sourceDocumentId?: string; extractionStatus?: string };
  matterStatus?: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onDeleted: (documentId: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  if (PROTECTED_DOCUMENT_TYPES.has(document.type) || document.sourceDocumentId
    || matterStatus === 'CLOSED' || matterStatus === 'CANCELLED') return null;

  function open() {
    setReason(''); setConfirmation(''); setError(''); onError('');
    dialog.current?.showModal();
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleting || reason.trim().length < 10 || confirmation !== 'ELIMINAR') return;
    setDeleting(true); onBusyChange(true); setError(''); onError('');
    try {
      await apiFetch(`/documents/${document.id}`, {
        method: 'DELETE', body: JSON.stringify({ reason: reason.trim(), confirmation }),
      });
      dialog.current?.close();
      await onDeleted(document.id);
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message); onError(message);
    } finally {
      setDeleting(false); onBusyChange(false);
    }
  }

  return <>
    <button type="button" className="link-button danger" disabled={disabled || deleting || document.extractionStatus === 'PROCESSING'} onClick={open}>Eliminar</button>
    <dialog className="document-delete-dialog" ref={dialog} aria-labelledby={titleId} onCancel={(event) => { if (deleting) event.preventDefault(); }}>
      <form onSubmit={(event) => void remove(event)}>
        <div><h2 id={titleId}>Eliminar archivo definitivamente</h2><p className="document-delete-file">{document.originalName}</p></div>
        <p>Se borrarán el archivo y sus extracciones asociadas. No podrás restaurarlos desde la aplicación. Los datos ya confirmados en Directorio no se deshacen.</p>
        <p className="form-hint">Si existen versiones anteriores, la anterior disponible puede volver a participar en el checklist. Para conservar el historial y retirar sólo su uso, cancela y utiliza Invalidar.</p>
        <label>Motivo de eliminación<textarea value={reason} minLength={10} maxLength={1000} rows={3} required disabled={deleting} onChange={(event) => setReason(event.target.value)} placeholder="Por ejemplo: cargué por error una identificación de prueba…" /></label>
        <label>Escribe ELIMINAR para confirmar<input value={confirmation} maxLength={8} required autoComplete="off" spellCheck={false} disabled={deleting} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} /></label>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="document-delete-actions"><button type="button" className="button secondary" disabled={deleting} onClick={() => dialog.current?.close()}>Cancelar</button><button type="submit" className="button document-delete-confirm" disabled={deleting || reason.trim().length < 10 || confirmation !== 'ELIMINAR'}>{deleting ? 'Eliminando…' : 'Eliminar definitivamente'}</button></div>
      </form>
    </dialog>
  </>;
}
