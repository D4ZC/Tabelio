export type DocumentReadingMode = 'local' | 'ai';

export interface AssistantContextMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  localOnly?: boolean;
}

export interface AssistantAttachmentReference {
  id: string;
  extractionMode?: DocumentReadingMode;
}

export function prepareAssistantTurn(text: string, fileCount: number, mode: DocumentReadingMode) {
  const localOnly = fileCount > 0 && mode === 'local';
  return {
    content: text.trim() || (fileCount > 0
      ? localOnly
        ? 'Leer estos documentos localmente (sin IA).'
        : 'Identifica estos documentos, muéstrame sus datos preliminares y prepara su carga al expediente para mi confirmación. Pregúntame si falta identificar el expediente o la persona.'
      : ''),
    localOnly,
    requestAssistant: !localOnly,
  };
}

export function assistantConversationContext(messages: AssistantContextMessage[]) {
  return messages
    .filter((message) => message.id !== 'welcome' && !message.localOnly)
    .map(({ role, content }) => ({ role, content }));
}

export function assistantAiAttachmentIds(
  current: string[],
  attachments: AssistantAttachmentReference[],
  requestedMode: DocumentReadingMode,
) {
  const localIds = new Set(attachments.filter((item) => item.extractionMode === 'local' || requestedMode === 'local').map((item) => item.id));
  const newAiIds = requestedMode === 'ai'
    ? attachments.filter((item) => item.extractionMode !== 'local').map((item) => item.id)
    : [];
  return [...new Set([...current, ...newAiIds])].filter((id) => !localIds.has(id)).slice(-6);
}

export function extractedDocumentText(data?: Record<string, unknown>) {
  return typeof data?.extractedText === 'string' ? data.extractedText : '';
}

export function editableExtractionData(data?: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(data ?? {}).filter(([field]) => field !== 'extractedText'));
}
