'use client';

import { FormEvent, KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ApiError, apiFetch, downloadFromApi } from '@/lib/api';
import { formatVoiceTranscript, voiceRecognitionTranscript, type VoiceRecognitionResult } from '@/lib/voice-dictation';
import { assistantAiAttachmentIds, assistantConversationContext, prepareAssistantTurn, type DocumentReadingMode } from '@/lib/assistant-documents';
import { assistantDownloadDocumentId, assistantDownloads, type AssistantDownload } from '@/lib/assistant-downloads';
import { AssistantBudget } from './assistant-budget';

interface PendingAction {
  id: string;
  title: string;
  description: string;
  expiresAt: string;
  expired?: boolean;
  operations: Array<{
    title: string;
    summary: string;
    destructive: boolean;
  }>;
}

interface AssistantReply {
  message: string;
  continuationSuggested?: boolean;
  continuationId?: string;
  pendingAction?: PendingAction;
  downloads?: AssistantDownload[];
  clientActions: Array<{ type: 'navigate'; path: string }>;
  changed: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  continuationSuggested?: boolean;
  continuationId?: string;
  pendingAction?: PendingAction;
  downloads?: AssistantDownload[];
  attachments?: AttachmentPreview[];
  localOnly?: boolean;
}

interface AttachmentPreview {
  id: string;
  name: string;
  size: number;
  documentKind: 'INE' | 'PROOF_OF_ADDRESS' | 'OTHER' | 'UNREADABLE';
  data: Record<string, string>;
  message: string;
  expiresAt: string;
  extractionMode?: DocumentReadingMode;
  extractionMethod?: 'pdf-text' | 'ocr' | 'mixed';
  text?: string;
  provider?: string;
}

const documentKindLabels = { INE: 'INE / IFE', PROOF_OF_ADDRESS: 'Comprobante de domicilio', OTHER: 'Otro documento', UNREADABLE: 'Sin lectura disponible' };
const extractedFieldLabels: Record<string, string> = {
  legalName: 'Nombre completo / titular', givenName: 'Nombre(s)', familyName: 'Apellidos', curp: 'CURP',
  birthDate: 'Fecha de nacimiento', gender: 'Sexo', addressLine1: 'Calle y número',
  addressLine2: 'Colonia / complemento', city: 'Ciudad / municipio', state: 'Estado',
  postalCode: 'Código postal', identificationType: 'Identificación', identificationNumber: 'CIC',
};

interface ConversationContextMessage {
  role: 'user' | 'assistant';
  content: string;
  localOnly?: boolean;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<VoiceRecognitionResult> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const starterMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hola. Puedo consultar expedientes, tareas, documentos y reportes, y preparar cambios para tu confirmación. Puedes leer documentos localmente sin IA o elegir enviarlos a IA. Para conservar el original sin IA, súbelo desde Documentos del expediente. ¿Qué necesitas?',
};

const quickPrompts = [
  { title: 'Organiza mi día', description: 'Lo que necesita tu atención hoy', prompt: '¿Qué requiere mi atención hoy?', icon: 'sun' as const },
  { title: 'Encuentra un expediente', description: 'Toda la información, en un lugar', prompt: 'Busca un expediente', icon: 'folder' as const },
  { title: 'Revisa mis pendientes', description: 'Tus tareas y próximos pasos', prompt: 'Muéstrame mis tareas pendientes', icon: 'check' as const },
];

export function AiAssistant({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const storageKey = `despacho_assistant:${organizationId}:${userId}`;
  const pageMode = pathname === '/asistente';
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([starterMessage]);
  const [carriedContext, setCarriedContext] = useState<ConversationContextMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolvingAction, setResolvingAction] = useState('');
  const [hydratedKey, setHydratedKey] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const [secureContext, setSecureContext] = useState(true);
  const [listening, setListening] = useState(false);
  const [finishingDictation, setFinishingDictation] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [documentReadingMode, setDocumentReadingMode] = useState<DocumentReadingMode>('local');
  const [attachmentError, setAttachmentError] = useState('');
  const [readingDocuments, setReadingDocuments] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [usageRevision, setUsageRevision] = useState(0);
  const conversationIdRef = useRef<string | null>(null);
  const conversationCreationRef = useRef<Promise<string> | null>(null);
  const scopeRef = useRef(storageKey);
  scopeRef.current = storageKey;
  const attachmentIdsRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const hasConversation = messages.some((message) => message.id !== 'welcome');

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as {
        messages?: ChatMessage[];
        open?: boolean;
        expanded?: boolean;
        carriedContext?: ConversationContextMessage[];
        attachmentIds?: string[];
        conversationId?: string;
      } | null;
      conversationIdRef.current = typeof saved?.conversationId === 'string' && saved.conversationId.length <= 100
        ? saved.conversationId : null;
      setConversationId(conversationIdRef.current);
      attachmentIdsRef.current = assistantAiAttachmentIds(
        Array.isArray(saved?.attachmentIds) ? saved.attachmentIds.filter((id): id is string => typeof id === 'string') : [],
        saved?.messages?.flatMap((message) => message.attachments ?? []).filter((attachment) => attachment.extractionMode === 'local') ?? [],
        'ai',
      );
      setMessages(saved?.messages?.length
        ? expirePendingActions(saved.messages.slice(-30))
        : [starterMessage]);
      setOpen(typeof saved?.open === 'boolean' ? saved.open : false);
      setExpanded(typeof saved?.expanded === 'boolean' ? saved.expanded : false);
      setCarriedContext(Array.isArray(saved?.carriedContext)
        ? saved.carriedContext.filter(isConversationContextMessage).slice(-24)
        : []);
    } catch {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // Continúa sin persistencia si el navegador bloquea sessionStorage.
      }
      setMessages([starterMessage]);
      setOpen(false);
      setExpanded(false);
      setCarriedContext([]);
      attachmentIdsRef.current = [];
      conversationIdRef.current = null;
      setConversationId(null);
    }
    conversationCreationRef.current = null;
    setFiles([]);
    setDocumentReadingMode('local');
    setAttachmentError('');
    setBusy(false);
    setResolvingAction('');
    setReadingDocuments(false);
    setHydratedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (hydratedKey !== storageKey) return;
    persist(messages, open, expanded, carriedContext);
    // Persistimos únicamente durante la sesión de la pestaña.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, open, expanded, carriedContext, hydratedKey, storageKey, conversationId]);

  useEffect(() => {
    const browserWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    setSpeechSupported(Boolean(browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition));
    setSecureContext(window.isSecureContext);
    return () => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) releaseRecognition(recognition);
    };
  }, []);

  useEffect(() => {
    if (!pageMode) return;
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    let fullHeight = window.innerHeight;
    const updateViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      const composing = document.activeElement === composerRef.current;
      if (!composing) fullHeight = window.innerHeight;
      root.style.setProperty('--assistant-viewport-height', `${height}px`);
      root.toggleAttribute('data-mobile-keyboard', composing && fullHeight - height > 120);
    };
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    window.addEventListener('resize', updateViewport);
    document.addEventListener('focusin', updateViewport);
    document.addEventListener('focusout', updateViewport);
    return () => {
      document.body.style.overflow = previousOverflow;
      root.style.removeProperty('--assistant-viewport-height');
      root.removeAttribute('data-mobile-keyboard');
      viewport?.removeEventListener('resize', updateViewport);
      window.removeEventListener('resize', updateViewport);
      document.removeEventListener('focusin', updateViewport);
      document.removeEventListener('focusout', updateViewport);
    };
  }, [pageMode]);

  const stopDictation = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) releaseRecognition(recognition);
    setListening(false);
    setFinishingDictation(false);
  }, []);

  const closeAssistant = useCallback(() => {
    stopDictation();
    if (pageMode) {
      setOpen(true);
      router.push('/expedientes');
      return;
    }
    setOpen(false);
    window.requestAnimationFrame(() => launcherRef.current?.focus());
  }, [pageMode, router, stopDictation]);

  useEffect(() => {
    if (pathname !== '/asistente' && window.matchMedia('(max-width: 760px)').matches) {
      setOpen(false);
      stopDictation();
    }
  }, [pathname, stopDictation]);

  useEffect(() => {
    if (!open && !pageMode) return;
    const frame = window.requestAnimationFrame(() => {
      if (window.matchMedia('(min-width: 761px)').matches) composerRef.current?.focus({ preventScroll: true });
    });
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.defaultPrevented || document.querySelector('dialog[open], .mobile-access-dialog')) return;
      event.preventDefault();
      closeAssistant();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [closeAssistant, open, pageMode]);

  useEffect(() => {
    if (!open && !pageMode) return;
    if (hasConversation) messageEndRef.current?.scrollIntoView({ block: 'end' });
    else messageEndRef.current?.parentElement?.scrollTo({ top: 0 });
  }, [messages, busy, open, pageMode, hasConversation]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(110, composer.scrollHeight)}px`;
  }, [input, open, pageMode]);

  useEffect(() => {
    const expirations = messages
      .filter((message) => message.pendingAction && !message.pendingAction.expired)
      .map((message) => Date.parse(message.pendingAction?.expiresAt ?? ''))
      .filter((expiresAt) => Number.isFinite(expiresAt));
    if (expirations.length === 0) return;
    const nextExpiration = Math.min(...expirations);
    const timer = window.setTimeout(() => {
      setMessages((current) => expirePendingActions(current));
    }, Math.max(0, nextExpiration - Date.now() + 50));
    return () => window.clearTimeout(timer);
  }, [messages]);

  function persist(
    nextMessages: ChatMessage[],
    nextOpen = open,
    nextExpanded = expanded,
    nextCarriedContext = carriedContext,
  ) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        messages: nextMessages.slice(-30),
        open: nextOpen,
        expanded: nextExpanded,
        carriedContext: nextCarriedContext.slice(-24),
        attachmentIds: attachmentIdsRef.current,
        conversationId: conversationIdRef.current,
      }));
    } catch {
      // El asistente sigue funcionando si el navegador bloquea o llena sessionStorage.
    }
  }

  async function ensureConversation() {
    if (conversationIdRef.current) return conversationIdRef.current;
    if (conversationCreationRef.current) return conversationCreationRef.current;
    const requestScope = storageKey;
    const creation = apiFetch<{ id: string }>('/ai-usage/conversations', { method: 'POST' }).then((result) => {
      if (scopeRef.current !== requestScope) throw new Error('La sesión cambió. Vuelve a abrir Tabelio IA.');
      conversationIdRef.current = result.id;
      setConversationId(result.id);
      persist(messages, true);
      return result.id;
    });
    conversationCreationRef.current = creation;
    try {
      return await creation;
    } finally {
      if (conversationCreationRef.current === creation) conversationCreationRef.current = null;
    }
  }

  function appendReply(reply: AssistantReply, localOnly = false) {
    const message: ChatMessage = {
      id: messageId(),
      role: 'assistant',
      content: reply.message,
      continuationSuggested: reply.continuationSuggested,
      continuationId: reply.continuationId,
      pendingAction: reply.pendingAction,
      downloads: assistantDownloads(reply.downloads),
      ...(localOnly ? { localOnly: true } : {}),
    };
    setMessages((current) => {
      const next = [...current, message].slice(-30);
      persist(next, true);
      return next;
    });
    const navigation = reply.clientActions.find((action) => action.type === 'navigate');
    const navigationIsCurrent = navigation ? isCurrentLocation(navigation.path) : false;
    if (navigation && !navigationIsCurrent) router.push(navigation.path);
    if (reply.changed) {
      window.dispatchEvent(new CustomEvent('assistant:data-changed'));
      if (!navigation || navigationIsCurrent) {
        window.setTimeout(() => window.location.reload(), 650);
      }
    }
  }

  async function sendMessage(text: string, continuationId?: string) {
    const selectedFiles = continuationId ? [] : files;
    const readingMode = documentReadingMode;
    const turn = prepareAssistantTurn(text, selectedFiles.length, readingMode);
    const content = turn.content;
    if (!content || busy || resolvingAction || finishingDictation || hydratedKey !== storageKey
      || (listening && recognitionRef.current?.interimResults === false)) return;
    const requestScope = storageKey;
    stopDictation();
    setVoiceError('');
    setAttachmentError('');
    setBusy(true);
    try {
      const activeConversationId = await ensureConversation();
      if (scopeRef.current !== requestScope) return;
      let attachments: AttachmentPreview[] = [];
      if (selectedFiles.length) {
        setReadingDocuments(true);
        const body = new FormData();
        for (const file of selectedFiles) body.append('files', file);
        const staged = await apiFetch<{ attachments: AttachmentPreview[]; activeAttachmentIds: string[] }>(`/assistant/attachments?conversationId=${encodeURIComponent(activeConversationId)}&extractionMode=${readingMode}`, { method: 'POST', body });
        if (scopeRef.current !== requestScope) return;
        attachments = staged.attachments;
        attachmentIdsRef.current = assistantAiAttachmentIds(attachmentIdsRef.current, attachments, readingMode);
        setFiles([]);
        setReadingDocuments(false);
      }
      setInput('');
      const userMessage: ChatMessage = {
        id: messageId(), role: 'user',
        content: [content, ...attachments.map((attachment) => `Adjunto: ${attachment.name}`)].join('\n').slice(0, 8_000),
        ...(attachments.length ? { attachments } : {}),
        ...(turn.localOnly ? { localOnly: true } : {}),
      };
      const nextMessages = [...messages, userMessage].slice(-30);
      setMessages(nextMessages);
      persist(nextMessages, true);
      if (!turn.requestAssistant) {
        appendReply({
          message: 'La lectura se procesó sin IA. Revisa el resultado y copia el texto disponible de cada documento. El mensaje que acompañó los archivos tampoco se envió a IA. Para conservar el original, súbelo desde Documentos del expediente.',
          clientActions: [], changed: false,
        }, true);
        await Promise.allSettled(attachments.map((attachment) => apiFetch(`/assistant/attachments/${encodeURIComponent(attachment.id)}`, { method: 'DELETE' })));
        return;
      }
      const reply = await apiFetch<AssistantReply>('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [
            ...assistantConversationContext(carriedContext),
            ...assistantConversationContext(nextMessages),
          ].slice(-24),
          context: { pathname, title: document.title },
          conversationId: activeConversationId,
          continuationId,
          attachmentIds: attachmentIdsRef.current,
        }),
      });
      if (scopeRef.current === requestScope) appendReply(reply);
    } catch (cause) {
      if (scopeRef.current !== requestScope) return;
      appendReply({
        message: (cause as Error).message,
        clientActions: [],
        changed: false,
      }, turn.localOnly);
    } finally {
      if (scopeRef.current === requestScope) {
        setBusy(false);
        setReadingDocuments(false);
        setUsageRevision((current) => current + 1);
      }
    }
  }

  function addFiles(incoming: File[]) {
    if (busy || resolvingAction) return;
    setAttachmentError('');
    if (files.length + incoming.length > 3) {
      setAttachmentError('Puedes adjuntar hasta tres documentos por mensaje.');
      return;
    }
    if (incoming.some((file) => !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024)) {
      setAttachmentError('Usa PDF, JPG o PNG de hasta 20 MB por archivo.');
      return;
    }
    setFiles((current) => [...current, ...incoming]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  async function resolveAction(action: PendingAction, approved: boolean) {
    if (resolvingAction || busy || hydratedKey !== storageKey) return;
    const requestScope = storageKey;
    if (isPendingActionExpired(action)) {
      markPendingActionExpired(action.id);
      appendReply({
        message: 'La confirmación ya venció. Vuelve a solicitar el cambio para revisar datos actualizados.',
        clientActions: [],
        changed: false,
      });
      return;
    }
    setResolvingAction(action.id);
    try {
      const reply = await apiFetch<AssistantReply>(`/assistant/actions/${action.id}`, {
        method: 'POST',
        body: JSON.stringify({ approved }),
      });
      if (scopeRef.current !== requestScope) return;
      clearPendingAction(action.id);
      appendReply(reply);
    } catch (cause) {
      if (scopeRef.current !== requestScope) return;
      if (cause instanceof ApiError && (cause.status === 404 || cause.status === 410)) {
        markPendingActionExpired(action.id);
      }
      appendReply({ message: (cause as Error).message, clientActions: [], changed: false });
    } finally {
      if (scopeRef.current === requestScope) {
        setResolvingAction('');
        setUsageRevision((current) => current + 1);
      }
    }
  }

  function clearPendingAction(actionId: string) {
    setMessages((current) => current.map((message) => (
      message.pendingAction?.id === actionId ? { ...message, pendingAction: undefined } : message
    )));
  }

  function markPendingActionExpired(actionId: string) {
    setMessages((current) => current.map((message) => (
      message.pendingAction?.id === actionId
        ? { ...message, pendingAction: { ...message.pendingAction, expired: true } }
        : message
    )));
  }

  function clearWindow() {
    stopDictation();
    const nextContext = [
      ...carriedContext,
      ...assistantConversationContext(messages),
    ].slice(-24);
    setCarriedContext(nextContext);
    setMessages([starterMessage]);
    setInput('');
    setVoiceError('');
    setFiles([]);
    setAttachmentError('');
    persist([starterMessage], true, expanded, nextContext);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function startNewConversation() {
    stopDictation();
    for (const id of attachmentIdsRef.current) {
      void apiFetch(`/assistant/attachments/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
    attachmentIdsRef.current = [];
    conversationIdRef.current = null;
    conversationCreationRef.current = null;
    setConversationId(null);
    setUsageRevision((current) => current + 1);
    setCarriedContext([]);
    setMessages([starterMessage]);
    setInput('');
    setVoiceError('');
    setFiles([]);
    setDocumentReadingMode('local');
    setAttachmentError('');
    persist([starterMessage], true, expanded, []);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function toggleDictation() {
    if (listening) {
      if (finishingDictation) return;
      // stop() lets the browser deliver its pending final result. abort() is
      // reserved for sending, editing, closing, or otherwise cancelling capture.
      setFinishingDictation(true);
      try {
        if (recognitionRef.current) recognitionRef.current.stop();
        else stopDictation();
      } catch {
        stopDictation();
      }
      return;
    }
    if (!window.isSecureContext) {
      setVoiceError('Para dictar desde tu teléfono, abre la conexión HTTPS del QR y confía en el certificado local.');
      return;
    }
    const browserWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Constructor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setVoiceError('Este navegador no admite dictado por voz. Prueba Safari en iPhone o Chrome en Android, o usa el micrófono de tu teclado.');
      return;
    }

    const recognition = new Constructor();
    const baseText = input.trim();
    // Mobile engines can accumulate overlapping interim hypotheses in continuous
    // mode. Request one final utterance on touch devices, including landscape.
    const mobileDictation = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    recognition.lang = 'es-MX';
    recognition.continuous = !mobileDictation;
    recognition.interimResults = !mobileDictation;
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      const transcript = voiceRecognitionTranscript(event.results, !mobileDictation);
      if (mobileDictation && !transcript) return;
      setInput([baseText, formatVoiceTranscript(transcript)].filter(Boolean).join(' '));
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      releaseRecognition(recognition);
      setListening(false);
      setFinishingDictation(false);
      setVoiceError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Activa el permiso del micrófono en los ajustes del navegador para usar el dictado.'
        : event.error === 'network' ? 'El servicio de dictado necesita conexión a internet. Revisa tu conexión e inténtalo de nuevo.'
          : 'No pude escuchar con claridad. Inténtalo de nuevo.');
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setListening(false);
      setFinishingDictation(false);
    };
    recognitionRef.current = recognition;
    setVoiceError('');
    setListening(true);
    setFinishingDictation(false);
    try {
      recognition.start();
    } catch {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      releaseRecognition(recognition);
      setListening(false);
      setFinishingDictation(false);
      setVoiceError('No fue posible iniciar el dictado.');
    }
  }

  const working = busy || Boolean(resolvingAction);
  const waitingForVoice = finishingDictation || (listening && recognitionRef.current?.interimResults === false);
  const visible = open || pageMode;
  const latestMessage = messages[messages.length - 1];

  return (
    <div className={`ai-assistant ${visible ? 'is-open' : ''} ${expanded && !pageMode ? 'is-expanded' : ''} ${pageMode ? 'ai-assistant-page' : ''}`}>
      {visible && (
        <section
          className={`ai-panel ${pageMode ? 'ai-panel-page' : ''}`}
          id="ai-assistant-panel"
          role="dialog"
          aria-labelledby="ai-assistant-title"
          aria-busy={working}
        >
          <header className="ai-header">
            <div className="ai-avatar" aria-hidden="true"><AssistantIcon name="sparkle" /></div>
            <div>
              <strong id="ai-assistant-title">Tabelio IA</strong>
              <span><i /> Tu espacio inteligente</span>
            </div>
            <div className="ai-header-actions">
              <button
                type="button"
                disabled={working}
                onClick={startNewConversation}
                aria-label="Iniciar nueva conversación"
                title="Nueva conversación"
              ><AssistantIcon name="new" /></button>
              <button
                type="button"
                disabled={working || (messages.length <= 1 && carriedContext.length === 0)}
                onClick={clearWindow}
                aria-label="Limpiar ventana conservando el contexto"
                title="Limpiar ventana y conservar contexto"
              ><AssistantIcon name="clear" /></button>
              {!pageMode && (
                <button
                  type="button"
                  onClick={() => setExpanded((current) => !current)}
                  aria-label={expanded ? 'Reducir Tabelio IA' : 'Expandir Tabelio IA'}
                  title={expanded ? 'Reducir panel' : 'Expandir panel'}
                >{expanded ? '⤡' : '⤢'}</button>
              )}
              {!pageMode && (
                <button
                  type="button"
                  onClick={() => {
                    persist(messages, true, expanded);
                    router.push('/asistente');
                  }}
                  aria-label="Abrir Tabelio IA en pantalla completa"
                  title="Abrir en pantalla completa"
                >↗</button>
              )}
              <button
                type="button"
                onClick={closeAssistant}
                aria-label={pageMode ? 'Volver al panel flotante' : 'Cerrar Tabelio IA'}
                title={pageMode ? 'Volver al panel flotante' : 'Cerrar'}
              >{pageMode ? '←' : '×'}</button>
            </div>
          </header>

          <AssistantBudget
            key={storageKey}
            scopeKey={storageKey}
            conversationId={conversationId}
            visible={visible && hydratedKey === storageKey}
            working={working}
            refreshRevision={usageRevision}
          />

          <div className={`ai-context-bar${pageMode && carriedContext.length === 0 ? ' ai-context-home' : ''}`}>
            <span>{carriedContext.length > 0 ? 'Contexto anterior conservado' : 'Contexto actual'}</span>
            <strong>{pageLabel(pathname)}</strong>
          </div>

          <div className={`ai-messages${!hasConversation ? ' ai-messages-welcome' : ''}`} role="log" aria-live="polite" aria-relevant="additions text">
            {!hasConversation && (
              <div className="ai-welcome">
                <div className="ai-welcome-emblem" aria-hidden="true"><AssistantIcon name="sparkle" /><span /><i /></div>
                <span className="ai-welcome-eyebrow">MENOS GESTIÓN. MÁS CLARIDAD.</span>
                <h1>Tu despacho,<br /><em>a una conversación.</em></h1>
                <p>Expedientes, documentos y pendientes.<br />Dime qué necesitas y lo resolvemos.</p>
                <div className="ai-welcome-prompts" aria-label="Ideas para comenzar">
                  {quickPrompts.map((item) => (
                    <button type="button" key={item.title} disabled={working} onClick={() => void sendMessage(item.prompt)}>
                      <span className="ai-prompt-icon"><AssistantIcon name={item.icon} /></span>
                      <span><strong>{item.title}</strong><small>{item.description}</small></span>
                      <AssistantIcon name="arrow" />
                    </button>
                  ))}
                </div>
                <span className="ai-welcome-note"><AssistantIcon name="shield" /> Tú confirmas los cambios. Siempre.</span>
              </div>
            )}
            {messages.filter((message) => message.id !== 'welcome').map((message) => (
              <article className={`ai-message ai-message-${message.role}`} key={message.id}>
                {message.role === 'assistant' && <span className="ai-message-mark">✦</span>}
                <div>
                  {message.localOnly && <span className="ai-local-message-label">Lectura local · sin IA</span>}
                  {message.role === 'assistant'
                    ? <AssistantMarkdown content={message.content} downloads={assistantDownloads(message.downloads)} navigate={(path) => router.push(path)} />
                    : <p>{message.content}</p>}
                  {message.role === 'assistant' && assistantDownloads(message.downloads).length > 0 && (
                    <div className="ai-document-downloads" aria-label="Documentos disponibles para descargar">
                      {assistantDownloads(message.downloads).map((download) => (
                        <AssistantDownloadButton key={download.documentId} documentId={download.documentId} fileName={download.fileName}>
                          Descargar {download.fileName}
                        </AssistantDownloadButton>
                      ))}
                    </div>
                  )}
                  {message.attachments?.map((attachment) => (
                    <details className="ai-document-preview" key={attachment.id} open>
                      <summary>{attachment.extractionMode === 'local' ? 'Lectura local' : documentKindLabels[attachment.documentKind]} · {attachment.name}</summary>
                      <span className="ai-document-preview-label">{attachment.extractionMode === 'local'
                        ? `Sin IA · 0 llamadas de IA · sin consumo del proveedor · ${attachment.extractionMethod === 'pdf-text' ? 'texto del PDF' : attachment.extractionMethod === 'mixed' ? 'texto del PDF y OCR' : attachment.extractionMethod === 'ocr' ? 'OCR local' : 'lectura local'} · revisar contra el original`
                        : 'Con IA · vista preliminar · revisar contra el original'}</span>
                      {attachment.extractionMode === 'local' ? attachment.text && <label className="extracted-document-text">Texto leído · selecciona para copiar<textarea readOnly rows={8} value={attachment.text} onFocus={(event) => event.currentTarget.select()} /></label> : <dl>
                        {Object.entries(attachment.data).map(([field, value]) => (
                          <div key={field}><dt>{extractedFieldLabels[field] ?? field}</dt><dd>{value}</dd></div>
                        ))}
                      </dl>}
                      <p>{attachment.message}</p>
                    </details>
                  ))}
                  {message.role === 'assistant' && message.id === latestMessage?.id && message.continuationSuggested && (
                    <div className="ai-continuation-actions" aria-label="Opciones para continuar">
                      <button
                        type="button"
                        className="button primary"
                        disabled={working}
                        onClick={() => void sendMessage('Continúa desde donde te quedaste', message.continuationId)}
                      >Continuar con IA</button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={working}
                        onClick={startNewConversation}
                      >Nueva actividad</button>
                    </div>
                  )}
                  {message.pendingAction && (
                    <div className={`ai-confirmation ${message.pendingAction.operations.some((item) => item.destructive) ? 'is-sensitive' : ''} ${message.pendingAction.expired ? 'is-expired' : ''}`}>
                      <span className="ai-confirmation-label">{message.pendingAction.expired ? 'Confirmación vencida' : 'Confirmación requerida'}</span>
                      <strong>{message.pendingAction.title}</strong>
                      <p>{message.pendingAction.expired
                        ? 'Esta confirmación ya no se puede ejecutar. Vuelve a solicitar el cambio para revisar datos actualizados.'
                        : message.pendingAction.description}</p>
                      {message.pendingAction.operations.map((operation, index) => (
                        <details key={`${operation.title}-${index}`}>
                          <summary>{operation.title}</summary>
                          <pre>{operation.summary}</pre>
                        </details>
                      ))}
                      {!message.pendingAction.expired && <div className="ai-confirmation-actions">
                        <button
                          type="button"
                          className="button secondary"
                          disabled={working}
                          onClick={() => void resolveAction(message.pendingAction!, false)}
                        >Cancelar</button>
                        <button
                          type="button"
                          className="button primary"
                          disabled={working}
                          onClick={() => void resolveAction(message.pendingAction!, true)}
                        >{resolvingAction === message.pendingAction.id ? 'Aplicando…' : 'Confirmar'}</button>
                      </div>}
                    </div>
                  )}
                </div>
              </article>
            ))}
            {busy && (
              <article className="ai-message ai-message-assistant">
                <span className="ai-message-mark">✦</span>
                <div className="ai-typing" role="status" aria-label={readingDocuments ? 'Leyendo documentos' : 'Tabelio IA está escribiendo'}>
                  {readingDocuments ? <span>Leyendo documentos…</span> : <><i /><i /><i /></>}
                </div>
              </article>
            )}
            <div ref={messageEndRef} />
          </div>

          <form
            className="ai-composer"
            onSubmit={submit}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) event.preventDefault();
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.files.length) return;
              event.preventDefault();
              addFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <details className="ai-document-options" open={files.length > 0 ? true : undefined}>
              <summary><AssistantIcon name="document" /><span>Lectura de adjuntos</span><strong>{documentReadingMode === 'local' ? 'Local · sin IA' : 'Con IA'}</strong><span className="ai-options-chevron" aria-hidden="true">⌄</span></summary>
            <div className="ai-reading-mode" role="group" aria-label="Lectura de documentos adjuntos">
              <span>Documentos</span>
              <button type="button" disabled={working} aria-pressed={documentReadingMode === 'local'} onClick={() => setDocumentReadingMode('local')}>Sin IA · local</button>
              <button type="button" disabled={working} aria-pressed={documentReadingMode === 'ai'} onClick={() => setDocumentReadingMode('ai')}>Con IA</button>
            </div>
            <p className="ai-reading-mode-hint">{documentReadingMode === 'local'
              ? files.length ? 'Los archivos y el mensaje que los acompaña se leerán localmente. Para guardar el original, usa Documentos del expediente.' : 'Adjuntos: lectura local sin IA. Los mensajes sin archivos sí se envían a Tabelio IA.'
              : 'Los archivos y el mensaje se enviarán al proveedor IA y generarán consumo. Revisarás los datos antes de guardarlos.'}</p>
            </details>
            {voiceError && <span className="ai-voice-error" role="alert">{voiceError}</span>}
            {attachmentError && <span className="ai-voice-error" role="alert">{attachmentError}</span>}
            {files.length > 0 && <ul className="ai-attachments" aria-label="Documentos por enviar">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <span>{file.name} <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span>
                  <button type="button" disabled={working} aria-label={`Quitar ${file.name}`} onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}>×</button>
                </li>
              ))}
            </ul>}
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            <div className="ai-composer-input">
              <button
                type="button"
                className="ai-attach"
                disabled={working || files.length >= 3}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Adjuntar documentos"
                title="Adjuntar documento · PDF, JPG o PNG · máximo 20 MB"
              ><AssistantIcon name="attach" /></button>
              <textarea
                ref={composerRef}
                aria-label="Mensaje para Tabelio IA"
                rows={1}
                maxLength={8_000}
                placeholder={listening ? 'Te escucho…' : '¿En qué te ayudo?'}
                value={input}
                onChange={(event) => {
                  if (listening) stopDictation();
                  setInput(event.target.value);
                }}
                onKeyDown={handleComposerKeyDown}
                onPaste={(event) => {
                  if (!event.clipboardData.files.length) return;
                  event.preventDefault();
                  addFiles(Array.from(event.clipboardData.files));
                }}
                disabled={working}
              />
              <button
                type="button"
                className={`ai-mic ${listening ? 'is-listening' : ''}`}
                onClick={toggleDictation}
                disabled={working || finishingDictation}
                aria-pressed={listening}
                aria-label={finishingDictation ? 'Terminando dictado' : listening ? 'Detener dictado' : 'Iniciar dictado por voz'}
                title={!secureContext ? 'El micrófono requiere una conexión HTTPS' : speechSupported ? 'Dictado por voz' : 'Ver alternativas de dictado'}
              ><AssistantIcon name={listening ? 'stop' : 'mic'} /></button>
              <button className="ai-send" type="submit" disabled={working || waitingForVoice || (!input.trim() && !files.length)} aria-label={files.length && documentReadingMode === 'local' ? 'Leer documentos sin IA' : 'Enviar mensaje a IA'}><AssistantIcon name={files.length && documentReadingMode === 'local' ? 'check' : 'send'} /></button>
            </div>
            {listening ? <div className="ai-listening-status" role="status"><span /><span /><span /><span /><span /> {finishingDictation ? 'Terminando de transcribir…' : 'Escuchando · toca el micrófono para terminar'}</div> : <small>Escribe, habla o adjunta un documento · hasta 3 de 20 MB</small>}
          </form>
        </section>
      )}

      {!pageMode && <button
        ref={launcherRef}
        type="button"
        className="ai-launcher"
        onClick={() => {
          if (open) closeAssistant();
          else setOpen(true);
        }}
        aria-expanded={open}
        aria-controls="ai-assistant-panel"
        aria-label={open ? 'Cerrar Tabelio IA' : 'Abrir Tabelio IA'}
      >
        <span>✦</span>
        {!open && <em>Tabelio IA</em>}
      </button>}
    </div>
  );
}

function AssistantIcon({ name }: { name: 'sparkle' | 'sun' | 'folder' | 'check' | 'arrow' | 'shield' | 'document' | 'attach' | 'mic' | 'stop' | 'send' | 'new' | 'clear' }) {
  const paths = {
    sparkle: <><path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z" /><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    folder: <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Zm0 3h18" />,
    check: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    shield: <><path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6Z" /><path d="m8 12 3 3 5-6" /></>,
    document: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8m-8 4h5" /></>,
    attach: <path d="m9 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8a2 2 0 0 1 3 3l-8 8" />,
    mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    send: <path d="M12 20V4m-6 6 6-6 6 6" />,
    new: <><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M15 3h6m-3-3v6" /><path d="m10 14 2-.5L21 5a2 2 0 0 0-3-3l-8.5 9Z" /></>,
    clear: <><path d="m16 3 5 5-10 12H6l-4-5Z" /><path d="m8 9 8 7M11 20h10" /></>,
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function AssistantMarkdown({
  content,
  downloads,
  navigate,
}: {
  content: string;
  downloads: AssistantDownload[];
  navigate: (path: string) => void;
}) {
  return (
    <div className="ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const documentId = assistantDownloadDocumentId(href);
            if (documentId) {
              return <AssistantDownloadButton documentId={documentId} fileName={downloads.find((download) => download.documentId === documentId)?.fileName} inline>{children}</AssistantDownloadButton>;
            }
            const internal = Boolean(href && href.startsWith('/') && !href.startsWith('//'));
            return (
              <a
                href={href}
                target={internal ? undefined : '_blank'}
                rel={internal ? undefined : 'noreferrer noopener'}
                onClick={(event) => {
                  if (
                    !internal
                    || !href
                    || event.button !== 0
                    || event.metaKey
                    || event.ctrlKey
                    || event.shiftKey
                    || event.altKey
                  ) return;
                  event.preventDefault();
                  navigate(href);
                }}
              >{children}</a>
            );
          },
          table: ({ children }) => (
            <div className="ai-markdown-table" role="region" aria-label="Tabla desplazable" tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
          img: ({ alt }) => <span className="ai-markdown-image">[Imagen: {alt || 'sin descripción'}]</span>,
        }}
      >{content}</ReactMarkdown>
    </div>
  );
}

function AssistantDownloadButton({
  documentId,
  fileName,
  children,
  inline = false,
}: {
  documentId: string;
  fileName?: string;
  children: ReactNode;
  inline?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    if (downloading) return;
    setDownloading(true);
    setError('');
    try {
      const path = `/documents/${encodeURIComponent(documentId)}`;
      const name = fileName ?? (await apiFetch<AssistantDownload>(`${path}/download-link`)).fileName;
      await downloadFromApi(`${path}/download`, name);
    } catch (cause) {
      setError(`No se pudo descargar el documento: ${cause instanceof Error ? cause.message : 'inténtalo de nuevo.'}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <span className="ai-document-download">
      <button type="button" className={`button ${inline ? 'text' : 'secondary'}`} disabled={downloading} onClick={() => void download()}>
        {downloading ? 'Descargando…' : children}
      </button>
      {error && <span className="ai-download-error" role="alert">{error}</span>}
    </span>
  );
}

function pageLabel(pathname: string) {
  if (pathname.startsWith('/expedientes/')) return 'Detalle de expediente';
  const labels: Record<string, string> = {
    '/buscar': 'Búsqueda',
    '/expedientes': 'Expedientes',
    '/documentos': 'Documentos',
    '/extracciones': 'Extracciones',
    '/tareas': 'Tareas',
    '/avisos': 'Avisos',
    '/reportes': 'Reportes',
    '/administracion/puesta-en-marcha': 'Puesta en marcha',
    '/piloto': 'Prueba inicial',
    '/piloto/operacion': 'Seguimiento de la prueba',
    '/lanzamiento': 'Revisión y aprobación',
    '/auditoria': 'Auditoría',
    '/directorio': 'Directorio',
    '/requisitos': 'Requisitos',
    '/clausulas': 'Cláusulas',
    '/equipo': 'Equipo',
    '/cuenta': 'Mi cuenta',
    '/asistente': 'Tabelio IA en pantalla completa',
  };
  return labels[pathname] ?? 'Tabelio';
}

function messageId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function isConversationContextMessage(value: unknown): value is ConversationContextMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConversationContextMessage>;
  return (candidate.role === 'user' || candidate.role === 'assistant')
    && typeof candidate.content === 'string'
    && candidate.content.trim().length > 0;
}

function releaseRecognition(recognition: SpeechRecognitionLike) {
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
  try {
    recognition.abort();
  } catch {
    // Algunos navegadores lanzan si la instancia ya terminó.
  }
}

function isPendingActionExpired(action: PendingAction, now = Date.now()) {
  const expiresAt = Date.parse(action.expiresAt);
  return action.expired === true || !Number.isFinite(expiresAt) || expiresAt <= now;
}

function expirePendingActions(messages: ChatMessage[], now = Date.now()) {
  let changed = false;
  const next = messages.map((message) => {
    if (
      !message.pendingAction
      || message.pendingAction.expired
      || !isPendingActionExpired(message.pendingAction, now)
    ) return message;
    changed = true;
    return {
      ...message,
      pendingAction: { ...message.pendingAction, expired: true },
    };
  });
  return changed ? next : messages;
}

function isCurrentLocation(path: string) {
  try {
    const destination = new URL(path, window.location.origin);
    return `${destination.pathname}${destination.search}${destination.hash}`
      === `${window.location.pathname}${window.location.search}${window.location.hash}`;
  } catch {
    return false;
  }
}
