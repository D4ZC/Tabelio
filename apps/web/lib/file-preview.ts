/**
 * Espejo de `previewPlan` en apps/api/src/documents/preview/document-preview.service.ts.
 * Sólo decide si se ofrece el botón; la API vuelve a validar cada solicitud.
 */
const PREVIEWABLE_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg',
  'text/plain', 'text/csv', 'text/xml', 'application/xml', 'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf', 'text/rtf',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]);

const PREVIEWABLE_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mp3', 'm4a', 'wav', 'ogg',
  'txt', 'csv', 'xml', 'json', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'odt', 'ods', 'odp',
]);

const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export function canPreview(mimeType: string | null | undefined, fileName = '') {
  const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (!GENERIC_TYPES.has(type)) return PREVIEWABLE_TYPES.has(type);
  const extension = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  return PREVIEWABLE_EXTENSIONS.has(extension);
}

/** Los archivos de oficina se convierten en el servidor; se avisa que pueden tardar. */
export function needsConversion(mimeType: string | null | undefined) {
  const type = (mimeType ?? '').toLowerCase();
  return type.includes('word') || type.includes('excel') || type.includes('powerpoint')
    || type.includes('officedocument') || type.includes('opendocument') || type.includes('rtf');
}

export type PreviewKind = 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'unsupported';

/** Decide cómo mostrar la respuesta según el tipo que devolvió la API. */
export function previewKind(contentType: string): PreviewKind {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  // SVG queda excluido: podría contener scripts.
  if (type.startsWith('image/') && type !== 'image/svg+xml') return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'text/plain') return 'text';
  return 'unsupported';
}

/** Muchos archivos antiguos están en Windows-1252; si no son UTF-8 válido se decodifican así. */
export function decodeText(bytes: ArrayBuffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
