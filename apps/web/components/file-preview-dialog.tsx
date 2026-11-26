'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { blobFromApi } from '@/lib/api';
import { decodeText, needsConversion, previewKind, type PreviewKind } from '@/lib/file-preview';

export interface FilePreviewTarget {
  /** Ruta de la API que devuelve el archivo en modo `inline`. */
  path: string;
  name: string;
  mimeType?: string | null;
  onDownload?: () => void | Promise<void>;
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; kind: Exclude<PreviewKind, 'text' | 'unsupported'>; url: string }
  | { status: 'ready'; kind: 'text'; text: string }
  | { status: 'ready'; kind: 'unsupported' };

export function FilePreviewDialog({ target, onClose }: { target?: FilePreviewTarget; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (target && !element.open) element.showModal();
    if (!target && element.open) element.close();
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const blob = await blobFromApi(target.path, controller.signal);
        const kind = previewKind(blob.type);
        if (controller.signal.aborted) return;
        if (kind === 'text') {
          setState({ status: 'ready', kind, text: decodeText(await blob.arrayBuffer()) });
        } else if (kind === 'unsupported') {
          setState({ status: 'ready', kind });
        } else {
          objectUrl = URL.createObjectURL(blob);
          setState({ status: 'ready', kind, url: objectUrl });
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: (cause as Error).message || 'No fue posible abrir la vista previa.' });
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target]);

  async function download() {
    if (!target?.onDownload || downloading) return;
    setDownloading(true);
    try { await target.onDownload(); } finally { setDownloading(false); }
  }

  return <dialog className="file-preview-dialog" ref={dialog} aria-labelledby={titleId} onClose={onClose}>
    <header className="file-preview-header">
      <div><span className="eyebrow">Vista previa</span><h2 id={titleId}>{target?.name}</h2></div>
      <div className="heading-actions">
        {target?.onDownload && <button type="button" className="button secondary" disabled={downloading} onClick={() => void download()}>{downloading ? 'Descargando…' : 'Descargar'}</button>}
        <button type="button" className="button secondary" onClick={() => dialog.current?.close()} aria-label="Cerrar vista previa">Cerrar</button>
      </div>
    </header>
    <div className="file-preview-body">
      {target && <PreviewBody state={state} name={target.name} converting={needsConversion(target.mimeType)} />}
    </div>
  </dialog>;
}

function PreviewBody({ state, name, converting }: { state: PreviewState; name: string; converting: boolean }) {
  if (state.status === 'loading') {
    return <div className="file-preview-state" role="status">
      <strong>Preparando vista previa…</strong>
      {converting && <span>Los archivos de Word, Excel o PowerPoint se convierten a PDF; puede tardar unos segundos.</span>}
    </div>;
  }
  if (state.status === 'error') {
    return <div className="file-preview-state" role="alert"><strong>No fue posible mostrar el archivo</strong><span>{state.message}</span></div>;
  }
  switch (state.kind) {
    case 'pdf': return <iframe src={state.url} title={`Vista previa de ${name}`} />;
    case 'image': return <img src={state.url} alt={`Vista previa de ${name}`} />;
    case 'video': return <video src={state.url} controls />;
    case 'audio': return <audio src={state.url} controls />;
    case 'text': return <pre className="file-preview-text" tabIndex={0}>{state.text || 'El archivo está vacío.'}</pre>;
    default: return <div className="file-preview-state"><strong>Este archivo no tiene vista previa</strong><span>Descárgalo para abrirlo.</span></div>;
  }
}
