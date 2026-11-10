import type { AssistantToolResult } from './assistant-mcp.service';

export interface AssistantDownload {
  documentId: string;
  fileName: string;
}

const GENERATION_TOOLS = new Set([
  'despacho_documents_generate_lease_draft',
  'despacho_documents_generate_agreement_draft',
  'despacho_documents_generate_pdf_preview',
]);

// Only application results may provide download buttons; model-written URLs cannot.
export function documentDownloads(toolName: string, result: AssistantToolResult): AssistantDownload[] {
  if (result.isError || (!GENERATION_TOOLS.has(toolName) && toolName !== 'despacho_documents_download_link')) {
    return [];
  }
  const structured = result.structuredContent as { result?: Record<string, unknown> } | undefined;
  const document = structured?.result;
  if (!document) return [];
  const documentId = GENERATION_TOOLS.has(toolName) ? document.id : document.documentId;
  const fileName = GENERATION_TOOLS.has(toolName) ? document.originalName : document.fileName;
  if (typeof documentId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(documentId)
    || typeof fileName !== 'string' || !fileName.trim() || fileName.length > 512) return [];
  return [{ documentId, fileName }];
}

export function addDocumentDownloads(downloads: AssistantDownload[], incoming: AssistantDownload[]) {
  for (const download of incoming) {
    if (!downloads.some((item) => item.documentId === download.documentId)) downloads.push(download);
  }
}
