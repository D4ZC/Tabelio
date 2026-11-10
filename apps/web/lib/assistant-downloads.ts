export interface AssistantDownload {
  documentId: string;
  fileName: string;
}

export function assistantDownloadDocumentId(href?: string) {
  return href?.match(/^\/(?:api\/)?documents\/([A-Za-z0-9_-]{1,256})\/download$/)?.[1];
}

export function assistantDownloads(value: unknown): AssistantDownload[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((entry): entry is AssistantDownload => {
    if (!entry || typeof entry !== 'object') return false;
    const { documentId, fileName } = entry;
    if (
      typeof documentId !== 'string'
      || !/^[A-Za-z0-9_-]{1,256}$/.test(documentId)
      || typeof fileName !== 'string'
      || !fileName.trim()
      || /[\r\n\0]/.test(fileName)
      || seen.has(documentId)
    ) return false;
    seen.add(documentId);
    return true;
  }).slice(0, 10).map(({ documentId, fileName }) => ({ documentId, fileName }));
}
