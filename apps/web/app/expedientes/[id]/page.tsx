'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { DeleteDocumentButton } from '@/components/delete-document-button';
import { StatusPill } from '@/components/status-pill';
import { MatterInsights } from '@/components/matter-insights';
import { DocumentInsights } from '@/components/document-insights';
import { apiFetch, blobFromApi, downloadFromApi } from '@/lib/api';
import { IDENTITY_DOCUMENT_TYPES } from '@/lib/identity-review';
import type { InsightSettings } from '@/lib/insights';
import type {
  Clause,
  ExtractionSettings,
  DocumentComparison,
  MatterDetail,
  Person,
  PortalInvitation,
  Property,
  TaskAssignee,
  TaskStatus,
} from '@/lib/types';

const roleLabels: Record<string, string> = {
  LANDLORD: 'Arrendador/a', TENANT: 'Arrendatario/a', GUARANTOR: 'Obligado solidario',
  REQUESTING_PARTY: 'Parte solicitante', COMPLEMENTARY_PARTY: 'Parte complementaria',
};
const docLabels: Record<string, string> = {
  LANDLORD_ID: 'Identificación del arrendador', TENANT_ID: 'Identificación del arrendatario',
  GUARANTOR_ID: 'Identificación del obligado solidario', PROPERTY_TITLE: 'Acreditación de propiedad',
  GUARANTEE_PROPERTY_TITLE: 'Acreditación del inmueble en garantía', LEASE_ANNEX: 'Contrato / Anexo 1',
  DRAFT_CONTRACT: 'Borrador de contrato', SIGNED_CONTRACT: 'Contrato firmado', OTHER: 'Otro',
  DRAFT_CONTRACT_PDF: 'Vista previa PDF del borrador',
  TERMINATION_EVIDENCE: 'Evidencia de terminación',
  TAX_ID: 'Constancia fiscal', PROOF_OF_ADDRESS: 'Comprobante de domicilio',
};
const reviewDecisionLabels: Record<string, string> = {
  CHANGES_REQUESTED: 'Cambios solicitados',
  LEGAL_APPROVED: 'Aprobación jurídica',
  FINAL_APPROVED: 'Aprobación final',
};
const signatureStatusLabels: Record<string, string> = {
  PENDING: 'Pendiente de firma',
  COMPLETED: 'Firma completada',
  CANCELLED: 'Solicitud cancelada',
  FAILED: 'Firma fallida',
};
const terminationStatusLabels: Record<string, string> = {
  OPEN: 'Terminación abierta',
  COMPLETED: 'Expediente cerrado',
  CANCELLED: 'Terminación cancelada',
};
const portalStatusLabels: Record<string, string> = {
  DRAFT: 'Captura en proceso', PENDING_REVIEW: 'Pendiente de revisión', ACCEPTED: 'Incorporada',
  REJECTED: 'Correcciones solicitadas', REVOKED: 'Revocada', EXPIRED: 'Vencida',
};
const taskStatusLabels: Record<TaskStatus, string> = {
  TODO: 'Por hacer', IN_PROGRESS: 'En curso', BLOCKED: 'Bloqueada', DONE: 'Completada', CANCELLED: 'Cancelada',
};
const taskPriorityLabels: Record<string, string> = {
  LOW: 'Baja', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente',
};
const consistencySeverityLabels = { HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Informativa' } as const;
const consistencyCategoryLabels = {
  DOCUMENT: 'Documento', PARTY: 'Participantes', TERMS: 'Condiciones', RELATION: 'Relación',
} as const;
const taskActions: Partial<Record<TaskStatus, Array<{ status: TaskStatus; label: string }>>> = {
  TODO: [{ status: 'IN_PROGRESS', label: 'Iniciar' }, { status: 'CANCELLED', label: 'Cancelar' }],
  IN_PROGRESS: [{ status: 'BLOCKED', label: 'Bloquear' }, { status: 'DONE', label: 'Completar' }],
  BLOCKED: [{ status: 'IN_PROGRESS', label: 'Retomar' }, { status: 'DONE', label: 'Completar' }],
  DONE: [{ status: 'TODO', label: 'Reabrir' }],
  CANCELLED: [{ status: 'TODO', label: 'Reabrir' }],
};
const nextStatus: Record<string, string> = {
  DRAFT: 'INTEGRATION', INTEGRATION: 'VALIDATION', PENDING_CLIENT: 'VALIDATION', VALIDATION: 'READY_TO_DRAFT',
  READY_TO_DRAFT: 'DRAFTING', DRAFTING: 'REVIEW',
};
const uploadableDocumentTypes = Object.entries(docLabels).filter(([value]) => ![
  'DRAFT_CONTRACT',
  'DRAFT_CONTRACT_PDF',
  'SIGNED_CONTRACT',
  'TERMINATION_EVIDENCE',
].includes(value));

type BatchUploadRow = {
  id: string;
  file: File;
  type: string;
  personId: string;
  propertyId: string;
  issuedAt: string;
  expiresAt: string;
  error?: string;
};

type BatchUploadResult = {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    index: number;
    originalName: string;
    type?: string;
    status: 'SUCCESS' | 'FAILED';
    error?: string;
    document?: { id: string; version: number };
  }>;
};

type DocumentClassificationDraft = {
  documentId: string;
  type: string;
  personId: string;
  propertyId: string;
};

export default function MatterPage() {
  const id = useParams<{ id: string }>().id;
  const router = useRouter();
  const [matter, setMatter] = useState<MatterDetail>();
  const [people, setPeople] = useState<Person[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tab, setTab] = useState<'overview' | 'documents' | 'tasks' | 'activity'>('overview');
  const [error, setError] = useState('');
  const [documentNotice, setDocumentNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [canAdvance, setCanAdvance] = useState(false);
  const [sessionRole, setSessionRole] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [comparison, setComparison] = useState<DocumentComparison>();
  const [clauseCatalog, setClauseCatalog] = useState<Clause[]>([]);
  const [clauseChoices, setClauseChoices] = useState<Record<string, string>>({});
  const [pdfPreview, setPdfPreview] = useState<{ documentId: string; name: string; url: string }>();
  const [portalInvitations, setPortalInvitations] = useState<PortalInvitation[]>([]);
  const [portalLink, setPortalLink] = useState('');
  const [taskAssignees, setTaskAssignees] = useState<TaskAssignee[]>([]);
  const [batchRows, setBatchRows] = useState<BatchUploadRow[]>([]);
  const [batchResult, setBatchResult] = useState<BatchUploadResult>();
  const [extractionSettings, setExtractionSettings] = useState<ExtractionSettings>();
  const [insightSettings, setInsightSettings] = useState<InsightSettings>();
  const [insightSettingsError, setInsightSettingsError] = useState('');
  const [uploadReadingMode, setUploadReadingMode] = useState<'none' | 'local' | 'ai'>('local');
  const [extractionProgress, setExtractionProgress] = useState('');
  const [identityExtractions, setIdentityExtractions] = useState<Array<{ documentId: string; name: string; status: string; message?: string }>>([]);
  const [filePickerKey, setFilePickerKey] = useState(0);
  const [classificationDraft, setClassificationDraft] = useState<DocumentClassificationDraft>();
  const [taskEvidenceSelections, setTaskEvidenceSelections] = useState<Record<string, string>>({});
  const [taskDependencySelections, setTaskDependencySelections] = useState<Record<string, string>>({});

  useEffect(() => {
    void apiFetch<ExtractionSettings>('/documents/extraction-settings').then(setExtractionSettings).catch(() => undefined);
    void apiFetch<InsightSettings>('/insights/settings').then((settings) => {
      setInsightSettings(settings);
      setInsightSettingsError('');
    }).catch(() => setInsightSettingsError('No se pudo verificar la disponibilidad de IA.'));
  }, []);

  useEffect(() => () => {
    if (pdfPreview) URL.revokeObjectURL(pdfPreview.url);
  }, [pdfPreview]);

  const load = async () => {
    try {
      const [matterData, personData, propertyData, invitationData, assigneeData] = await Promise.all([
        apiFetch<MatterDetail>(`/matters/${id}`), apiFetch<Person[]>('/people'), apiFetch<Property[]>('/properties'),
        apiFetch<PortalInvitation[]>(`/matters/${id}/portal-invitations`),
        apiFetch<TaskAssignee[]>('/tasks/assignees'),
      ]);
      setMatter(matterData); setPeople(personData); setProperties(propertyData);
      setPortalInvitations(invitationData);
      setTaskAssignees(assigneeData);
      setClauseChoices(Object.fromEntries(
        matterData.clauseSelections.map((selection) => [selection.clause.id, selection.clauseVersion.id]),
      ));
    } catch (cause) { setError((cause as Error).message); }
  };
  useEffect(() => {
    apiFetch<{ role: string }>('/auth/me')
      .then((session) => {
        setSessionRole(session.role);
        setCanAdvance(['ADMIN', 'LAWYER'].includes(session.role));
      })
      .catch((cause) => setError((cause as Error).message));
    void load();
  }, [id]);
  useEffect(() => {
    if (!matter || !['ADMIN', 'LAWYER'].includes(sessionRole)) return;
    apiFetch<Clause[]>(`/clauses?matterKind=${matter.kind}`)
      .then(setClauseCatalog)
      .catch((cause) => setError((cause as Error).message));
  }, [matter?.kind, sessionRole]);

  const completion = useMemo(() => {
    if (!matter?.checklistItems.length) return 0;
    return Math.round(matter.checklistItems.filter((item) => item.status !== 'PENDING').length / matter.checklistItems.length * 100);
  }, [matter]);
  const latestDraft = useMemo(
    () => matter?.documents
      .filter((document) => document.type === 'DRAFT_CONTRACT')
      .sort((left, right) => right.version - left.version)[0],
    [matter],
  );
  const evidenceDocuments = useMemo(
    () => {
      const now = new Date();
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      return matter?.documents.filter((document) => (
        document.isCurrentVersion
        && !document.invalidatedAt
        && (!document.expiresAt || new Date(document.expiresAt).getTime() >= today)
      )) ?? [];
    },
    [matter],
  );
  const canReview = ['ADMIN', 'LAWYER'].includes(sessionRole);
  const canApprove = sessionRole === 'ADMIN';
  const canManageChecklist = ['ADMIN', 'LAWYER', 'OPERATOR'].includes(sessionRole);
  const pendingSignature = matter?.signatureRequests.find((request) => request.status === 'PENDING');
  const completedSignature = matter?.signatureRequests.find((request) => request.status === 'COMPLETED');
  const openTermination = matter?.terminationProcesses.find((process) => process.status === 'OPEN');
  const completedTermination = matter?.terminationProcesses.find((process) => process.status === 'COMPLETED');
  const renewalDefaults = useMemo(() => {
    const currentEnd = matter?.leaseTerms?.endDate;
    if (!currentEnd) return undefined;
    const start = new Date(String(currentEnd));
    start.setUTCDate(start.getUTCDate() + 1);
    const durationMonths = Number(matter.leaseTerms?.durationMonths ?? 12);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + durationMonths);
    end.setUTCDate(end.getUTCDate() - 1);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      durationMonths,
    };
  }, [matter]);

  async function action(path: string, body: unknown) {
    setBusy(true); setError('');
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
      await load();
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally { setBusy(false); }
  }

  async function patchMatter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    try { await apiFetch(`/matters/${id}`, { method: 'PATCH', body: JSON.stringify(Object.fromEntries(Object.entries(raw).filter(([, value]) => value))) }); await load(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function assignResponsible(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const responsibleMembershipId = String(new FormData(event.currentTarget).get('responsibleMembershipId') ?? '');
    setBusy(true); setError('');
    try {
      await apiFetch(`/matters/${id}/responsible`, {
        method: 'PATCH',
        body: JSON.stringify({ responsibleMembershipId }),
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function saveLeaseTerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const raw = Object.fromEntries(new FormData(event.currentTarget));
    await action(`/matters/${id}/lease-terms`, {
      ...raw, rentAmount: Number(raw.rentAmount), depositAmount: raw.depositAmount ? Number(raw.depositAmount) : undefined,
      prepaidRentAmount: raw.prepaidRentAmount ? Number(raw.prepaidRentAmount) : undefined,
      dueDay: Number(raw.dueDay || 5), durationMonths: Number(raw.durationMonths || 12), maintenanceIncluded: true,
    });
  }

  async function saveMediation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    await action(
      `/matters/${id}/mediation-terms`,
      Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== '')),
    );
  }

  function defaultDocumentLinks(type: string) {
    const roleByType: Record<string, string> = {
      LANDLORD_ID: 'LANDLORD', TENANT_ID: 'TENANT', GUARANTOR_ID: 'GUARANTOR',
    };
    const personId = matter?.parties.find((party) => party.role === roleByType[type])?.person.id ?? '';
    const propertyId = type === 'PROPERTY_TITLE'
      ? matter?.propertyId ?? ''
      : type === 'GUARANTEE_PROPERTY_TITLE' ? matter?.guaranteePropertyId ?? '' : '';
    return { personId, propertyId };
  }

  function selectBatchFiles(files: FileList | null) {
    if (!files?.length) return;
    setBatchResult(undefined);
    setError('');
    const available = Math.max(0, 10 - batchRows.length);
    const incoming = Array.from(files);
    const oversized = incoming.filter((file) => file.size > 20 * 1024 * 1024);
    const selected = incoming.filter((file) => file.size <= 20 * 1024 * 1024).slice(0, available);
    const messages = [];
    if (oversized.length) messages.push(`${oversized.length} archivo(s) superan 20 MB y no se agregaron`);
    if (incoming.length - oversized.length > available) messages.push(`el lote admite máximo 10 archivos`);
    if (messages.length) setError(`${messages.join('; ')}.`);
    setBatchRows((current) => [...current, ...selected.map((file) => ({
      id: crypto.randomUUID(),
      file,
      type: 'OTHER',
      personId: '',
      propertyId: '',
      issuedAt: '',
      expiresAt: '',
    }))]);
    setFilePickerKey((current) => current + 1);
  }

  function updateBatchRow(rowId: string, changes: Partial<BatchUploadRow>) {
    setBatchRows((current) => current.map((row) => (
      row.id === rowId ? { ...row, ...changes, error: undefined } : row
    )));
  }

  function changeBatchType(rowId: string, type: string) {
    updateBatchRow(rowId, { type, ...defaultDocumentLinks(type) });
  }

  async function uploadBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batchRows.length) {
      setError('Selecciona al menos un archivo para cargar.');
      return;
    }
    setBusy(true); setError(''); setBatchResult(undefined); setIdentityExtractions([]);
    const rows = batchRows;
    const form = new FormData();
    rows.forEach((row) => form.append('files', row.file, row.file.name));
    form.set('metadata', JSON.stringify(rows.map((row) => ({
      type: row.type,
      personId: row.personId || undefined,
      propertyId: row.propertyId || undefined,
      issuedAt: row.issuedAt || undefined,
      expiresAt: row.expiresAt || undefined,
    }))));
    try {
      const result = await apiFetch<BatchUploadResult>(`/matters/${id}/documents/batch`, {
        method: 'POST', body: form,
      });
      setBatchResult(result);
      const failures = new Map(result.results
        .filter((item) => item.status === 'FAILED')
        .map((item) => [item.index, item.error ?? 'No fue posible guardar el archivo']));
      setBatchRows(rows.flatMap((row, index) => (
        failures.has(index) ? [{ ...row, error: failures.get(index)! }] : []
      )));
      await load();
      if (uploadReadingMode === 'local' || (uploadReadingMode === 'ai' && extractionSettings?.enabled)) {
        const candidates = result.results.filter((item) => item.document
          && item.status === 'SUCCESS' && (uploadReadingMode === 'local' || IDENTITY_DOCUMENT_TYPES.includes(rows[item.index].type)));
        const supportedMimeTypes = uploadReadingMode === 'local'
          ? extractionSettings?.local?.supportedMimeTypes ?? ['image/jpeg', 'image/png', 'application/pdf']
          : extractionSettings?.supportedMimeTypes ?? [];
        const readings: Array<{ documentId: string; name: string; status: string; message?: string }> = [];
        for (const [index, item] of candidates.entries()) {
          const documentId = item.document!.id;
          if (!supportedMimeTypes.includes(rows[item.index].file.type)) {
            readings.push({ documentId, name: item.originalName, status: 'FAILED', message: 'Archivo guardado sin lectura. Para leer el contenido utiliza JPG, PNG o PDF.' });
          } else {
            setExtractionProgress(`Leyendo documento ${index + 1} de ${candidates.length} ${uploadReadingMode === 'local' ? 'localmente, sin IA' : 'con IA'}…`);
            try {
              const reading = await apiFetch<{ extraction: { status: string; message?: string } }>(`/documents/${documentId}/extraction`, { method: 'POST', body: JSON.stringify({ mode: uploadReadingMode }) });
              readings.push({ documentId, name: item.originalName, ...reading.extraction });
            } catch {
              readings.push({ documentId, name: item.originalName, status: 'FAILED', message: 'El archivo se guardó, pero no se pudo completar la lectura. Puedes volver a solicitarla.' });
            }
          }
          setIdentityExtractions([...readings]);
        }
        await load();
        if (readings.length === 1 && readings[0].status === 'MANUAL_REVIEW' && result.failed === 0) {
          router.push(`/extracciones?documentId=${encodeURIComponent(readings[0].documentId)}`);
        }
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); setExtractionProgress(''); }
  }

  async function saveDocumentClassification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classificationDraft) return;
    setBusy(true); setError('');
    try {
      await apiFetch(`/documents/${classificationDraft.documentId}/classification`, {
        method: 'PATCH',
        body: JSON.stringify({
          type: classificationDraft.type,
          personId: classificationDraft.personId || null,
          propertyId: classificationDraft.propertyId || null,
        }),
      });
      setClassificationDraft(undefined);
      await load();
      setDocumentNotice('Clasificación actualizada. La corrección quedó registrada en la bitácora.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function invalidateDocument(documentId: string) {
    const reason = window.prompt('Indica por qué debe retirarse este documento (mínimo 10 caracteres):')?.trim();
    if (reason === undefined) return;
    if (reason.length < 10) {
      setError('El motivo de invalidación debe tener al menos 10 caracteres.');
      return;
    }
    await action(`/documents/${documentId}/invalidate`, { reason });
  }

  async function restoreDocument(documentId: string) {
    if (!window.confirm('¿Restaurar este documento? Volverá a participar en checklist, vigencia y advertencias.')) return;
    await action(`/documents/${documentId}/restore`, {});
  }

  async function downloadDocument(documentId: string) {
    setError('');
    try {
      const document = matter?.documents.find((item) => item.id === documentId);
      await downloadFromApi(`/documents/${documentId}/download`, document?.originalName ?? 'documento');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function requestDocumentExtraction(documentId: string, mode: 'local' | 'ai' | 'manual' = 'local') {
    if (mode === 'ai' && (!extractionSettings?.enabled || !window.confirm(`Se enviará este documento a ${extractionSettings.provider} para leer sus datos con IA y generará consumo. La ficha no cambiará sin tu revisión posterior. ¿Continuar?`))) return;
    setBusy(true); setError('');
    try {
      const result = await apiFetch<{ extraction: { status: string; message?: string } }>(`/documents/${documentId}/extraction`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      await load();
      if (result.extraction.status === 'FAILED') setError(result.extraction.message ?? 'No se pudo leer el documento. El archivo sigue guardado.');
      else router.push(`/extracciones?documentId=${encodeURIComponent(documentId)}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadPortalUpload(uploadId: string, originalName: string) {
    setError('');
    try {
      await downloadFromApi(`/portal-uploads/${uploadId}/download`, originalName);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function previewDocument(documentId: string, name: string) {
    setBusy(true); setError('');
    try {
      const blob = await blobFromApi(`/documents/${documentId}/preview`);
      setPdfPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { documentId, name, url: URL.createObjectURL(blob) };
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function generatePdfPreview(documentId: string) {
    setBusy(true); setError('');
    try {
      const document = await apiFetch<{ id: string; originalName: string }>(
        `/documents/${documentId}/pdf-preview`,
        { method: 'POST' },
      );
      await load();
      await previewDocument(document.id, document.originalName);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  async function waiveChecklistItem(itemId: string) {
    const reason = window.prompt('Motivo jurídico u operativo de la dispensa (mínimo 10 caracteres):');
    if (reason === null) return;
    if (reason.trim().length < 10) {
      setError('La dispensa debe incluir un motivo de al menos 10 caracteres.');
      return;
    }
    await action(`/matters/${id}/checklist/${itemId}/waive`, { reason: reason.trim() });
  }

  async function setManualChecklistStatus(itemId: string, status: 'PENDING' | 'COMPLETE') {
    await action(`/matters/${id}/checklist/${itemId}/manual-status`, { status });
  }

  async function generateLeaseDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const executionDate = String(new FormData(event.currentTarget).get('executionDate') ?? '');
    await action(`/matters/${id}/documents/generate-lease`, { executionDate });
    setTab('documents');
  }

  async function generateAgreementDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const leaseExecutionDate = String(new FormData(event.currentTarget).get('leaseExecutionDate') ?? '');
    await action(`/matters/${id}/documents/generate-agreement`, { leaseExecutionDate });
    setTab('documents');
  }

  async function saveClauseSelection() {
    setBusy(true); setError('');
    try {
      const clauseVersionIds = clauseCatalog
        .map((clause) => clauseChoices[clause.id])
        .filter((versionId): versionId is string => Boolean(versionId));
      await apiFetch(`/matters/${id}/clauses`, {
        method: 'PUT',
        body: JSON.stringify({ clauseVersionIds }),
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function reviewDocument(actionName: string) {
    if (!latestDraft) {
      setError('No existe un borrador contractual para revisar.');
      return;
    }
    if (reviewComment.trim().length < 10) {
      setError('La decisión debe incluir un comentario de al menos 10 caracteres.');
      return;
    }
    const saved = await action(`/documents/${latestDraft.id}/reviews/${actionName}`, {
      comment: reviewComment.trim(),
    });
    if (saved) setReviewComment('');
  }

  async function compareDocument(documentId: string) {
    setBusy(true); setError('');
    try {
      setComparison(await apiFetch<DocumentComparison>(`/documents/${documentId}/compare-previous`));
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function completeSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingSignature) return;
    setBusy(true); setError('');
    const form = event.currentTarget;
    try {
      await apiFetch(`/matters/${id}/signatures/${pendingSignature.id}/complete`, {
        method: 'POST',
        body: new FormData(form),
      });
      form.reset();
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function cancelSignature(signatureId: string) {
    const comment = window.prompt('Motivo para cancelar la solicitud de firma (mínimo 10 caracteres):');
    if (comment === null) return;
    if (comment.trim().length < 10) {
      setError('El motivo de cancelación debe tener al menos 10 caracteres.');
      return;
    }
    await action(`/matters/${id}/signatures/${signatureId}/cancel`, { comment: comment.trim() });
  }

  async function cancelMatter() {
    const reason = window.prompt('Motivo para cancelar el expediente (mínimo 10 caracteres):');
    if (reason === null) return;
    if (reason.trim().length < 10) {
      setError('El motivo de cancelación debe tener al menos 10 caracteres.');
      return;
    }
    await action(`/matters/${id}/cancel`, { reason: reason.trim() });
  }

  async function createRenewal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError('');
    try {
      const renewal = await apiFetch<{ id: string }>(`/matters/${id}/renewals`, {
        method: 'POST',
        body: JSON.stringify({
          ...raw,
          durationMonths: Number(raw.durationMonths),
          rentAmount: raw.rentAmount ? Number(raw.rentAmount) : undefined,
        }),
      });
      router.push(`/expedientes/${renewal.id}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function startTermination(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    const saved = await action(
      `/matters/${id}/terminations`,
      Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== '')),
    );
    if (saved) event.currentTarget.reset();
  }

  async function cancelTermination(terminationId: string) {
    const reason = window.prompt('Motivo para cancelar la terminación (mínimo 10 caracteres):');
    if (reason === null) return;
    if (reason.trim().length < 10) {
      setError('El motivo de cancelación debe tener al menos 10 caracteres.');
      return;
    }
    await action(`/matters/${id}/terminations/${terminationId}/cancel`, { reason: reason.trim() });
  }

  async function completeTermination(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openTermination) return;
    setBusy(true); setError('');
    const form = event.currentTarget;
    try {
      await apiFetch(`/matters/${id}/terminations/${openTermination.id}/complete`, {
        method: 'POST',
        body: new FormData(form),
      });
      form.reset();
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  async function createPortalInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setPortalLink('');
    const form = event.currentTarget;
    try {
      const raw = Object.fromEntries(new FormData(form));
      const invitation = await apiFetch<{ portalUrl: string }>(`/matters/${id}/portal-invitations`, {
        method: 'POST',
        body: JSON.stringify({
          partyRole: raw.partyRole,
          invitedEmail: raw.invitedEmail || undefined,
          personId: raw.personId || undefined,
          expiresInDays: Number(raw.expiresInDays || 7),
        }),
      });
      setPortalLink(invitation.portalUrl);
      form.reset();
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function revokePortalInvitation(invitationId: string) {
    await action(`/matters/${id}/portal-invitations/${invitationId}/revoke`, {});
  }

  async function reviewPortalSubmission(submissionId: string, decision: 'accept' | 'reject') {
    const comment = window.prompt(
      decision === 'accept'
        ? 'Comentario de aceptación (mínimo 10 caracteres):'
        : 'Indica claramente qué debe corregirse (mínimo 10 caracteres):',
    );
    if (comment === null) return;
    if (comment.trim().length < 10) {
      setError('El comentario debe tener al menos 10 caracteres.');
      return;
    }
    await action(`/matters/${id}/portal-submissions/${submissionId}/${decision}`, { comment: comment.trim() });
  }

  async function copyPortalLink() {
    try {
      await navigator.clipboard.writeText(portalLink);
    } catch {
      setError('No se pudo copiar automáticamente; selecciona el enlace y cópialo manualmente.');
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = event.currentTarget;
    try {
      const raw = Object.fromEntries(new FormData(form));
      await apiFetch(`/matters/${id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: raw.title,
          description: raw.description || undefined,
          priority: raw.priority,
          dueAt: raw.dueAt || undefined,
          assigneeMembershipId: raw.assigneeMembershipId || undefined,
          requiresEvidence: raw.requiresEvidence === 'on',
        }),
      });
      form.reset();
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function changeTaskStatus(taskId: string, status: TaskStatus) {
    let reason: string | undefined;
    if (status === 'BLOCKED') {
      const entered = window.prompt('Explica el bloqueo (mínimo 10 caracteres):');
      if (entered === null) return;
      reason = entered.trim();
      if (reason.length < 10) {
        setError('El motivo del bloqueo debe tener al menos 10 caracteres.');
        return;
      }
    }
    await action(`/tasks/${taskId}/status`, { status, reason });
  }

  async function rescheduleTask(taskId: string, currentDueAt?: string) {
    const currentDate = currentDueAt ? new Date(currentDueAt).toISOString().slice(0, 10) : '';
    const enteredDate = window.prompt('Nueva fecha límite (AAAA-MM-DD):', currentDate);
    if (enteredDate === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(enteredDate) || Number.isNaN(new Date(`${enteredDate}T12:00:00`).getTime())) {
      setError('Indica una fecha válida con formato AAAA-MM-DD.');
      return;
    }
    const enteredReason = window.prompt('Motivo de la reprogramación (mínimo 10 caracteres):');
    if (enteredReason === null) return;
    const reason = enteredReason.trim();
    if (reason.length < 10) {
      setError('El motivo de la reprogramación debe tener al menos 10 caracteres.');
      return;
    }
    const dueAt = new Date(`${enteredDate}T23:59:59`).toISOString();
    await action(`/tasks/${taskId}/reschedule`, { dueAt, reason });
  }

  async function addTaskComment(taskId: string) {
    const entered = window.prompt('Nota de seguimiento (mínimo 3 caracteres):');
    if (entered === null) return;
    const body = entered.trim();
    if (body.length < 3) {
      setError('La nota debe tener al menos 3 caracteres.');
      return;
    }
    await action(`/tasks/${taskId}/comments`, { body });
  }

  async function linkTaskEvidence(taskId: string) {
    const documentId = taskEvidenceSelections[taskId];
    if (!documentId) {
      setError('Selecciona un documento vigente para vincularlo como evidencia.');
      return;
    }
    const linked = await action(`/tasks/${taskId}/evidence`, { documentId });
    if (linked) {
      setTaskEvidenceSelections((current) => ({ ...current, [taskId]: '' }));
    }
  }

  async function addTaskDependency(taskId: string) {
    const dependsOnTaskId = taskDependencySelections[taskId];
    if (!dependsOnTaskId) {
      setError('Selecciona una tarea que deba completarse primero.');
      return;
    }
    const linked = await action(`/tasks/${taskId}/dependencies`, { dependsOnTaskId });
    if (linked) {
      setTaskDependencySelections((current) => ({ ...current, [taskId]: '' }));
    }
  }

  async function removeTaskDependency(taskId: string, dependencyId: string) {
    setBusy(true); setError('');
    try {
      await apiFetch(`/tasks/${taskId}/dependencies/${dependencyId}`, { method: 'DELETE' });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!matter) return <AppShell><div className="page-loader">Cargando expediente…</div>{error && <div className="alert error">{error}</div>}</AppShell>;
  const forward = nextStatus[matter.status];
  const canManageTasks = ['ADMIN', 'LAWYER', 'OPERATOR'].includes(sessionRole);
  const isFinished = ['CLOSED', 'CANCELLED'].includes(matter.status);
  const insightRevision = `${matter.updatedAt}:${matter.consistency.evaluatedAt}`;
  const canCancelMatter = canAdvance && [
    'DRAFT', 'INTEGRATION', 'PENDING_CLIENT', 'VALIDATION', 'READY_TO_DRAFT', 'DRAFTING', 'REVIEW', 'APPROVAL', 'SIGNATURE',
  ].includes(matter.status);

  return (
    <AppShell>
      <div className="breadcrumbs"><Link href="/expedientes">Expedientes</Link><span>›</span>{matter.reference}</div>
      <header className="matter-header">
        <div><div className="matter-meta"><span>{matter.reference}</span><StatusPill status={matter.status} /></div><h1>{matter.title}</h1><p>{matter.kind === 'LEASE' ? 'Contrato de arrendamiento' : 'Convenio final de método alternativo'}{matter.property ? ` · ${matter.property.displayName}` : ''}</p></div>
        <div className="header-actions"><div className={`readiness-indicator readiness-${matter.readiness.level.toLowerCase()}`} title={matter.readiness.reasons.map((reason) => reason.label).join('\n') || matter.readiness.summary}><span></span><div><strong>{matter.readiness.label}</strong><small>{matter.readiness.summary}</small></div></div><span className="progress-label"><strong>{completion}%</strong> integrado</span>{canCancelMatter && <button className="button text danger" disabled={busy} onClick={() => void cancelMatter()}>Cancelar expediente</button>}{forward && canAdvance && <button className="button primary" disabled={busy} onClick={() => action(`/matters/${id}/transition`, { status: forward })}>Avanzar etapa →</button>}</div>
      </header>
      {error && <div className="alert error">{error}</div>}
      {documentNotice && <div className="alert info" role="status">{documentNotice}</div>}
      {matter.status === 'CANCELLED' && <div className="matter-cancellation-notice"><strong>Expediente cancelado</strong><span>{matter.cancellationReason}</span><small>{matter.cancelledBy?.displayName ?? 'Responsable no disponible'}{matter.cancelledAt ? ` · ${new Date(matter.cancelledAt).toLocaleString('es-MX')}` : ''}</small></div>}
      <div className="tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Resumen {matter.consistency.total > 0 && <span>{matter.consistency.total}</span>}</button><button className={tab === 'documents' ? 'active' : ''} onClick={() => setTab('documents')}>Documentos <span>{matter.documents.length}</span></button><button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>Tareas <span>{matter.tasks.length}</span></button><button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Actividad</button></div>

      {tab === 'overview' && <div className="detail-layout">
        <div className="detail-main">
          <MatterInsights key={matter.id} matterId={matter.id} revision={insightRevision} settings={insightSettings} settingsError={insightSettingsError} disabled={busy} />
          <section className={`card consistency-panel ${matter.consistency.high > 0 ? 'has-high' : ''}`}>
            <div className="section-heading"><div><h2>Validaciones de consistencia</h2><p>Reglas deterministas sin IA. Informan riesgos, pero no bloquean el flujo.</p></div><div className="consistency-counts"><span className="high">{matter.consistency.high} altas</span><span className="medium">{matter.consistency.medium} medias</span><span className="low">{matter.consistency.low} informativas</span></div></div>
            {matter.consistency.warnings.length === 0 ? <div className="consistency-clean"><span>✓</span><div><strong>Sin inconsistencias detectadas</strong><small>Las asociaciones, vigencias, roles, fechas e importes revisados son coherentes.</small></div></div> : <div className="consistency-list">
              {matter.consistency.warnings.map((warning) => <article key={`${warning.code}-${warning.entityId ?? warning.title}`}>
                <span className={`consistency-severity severity-${warning.severity.toLowerCase()}`}>{consistencySeverityLabels[warning.severity]}</span>
                <div><strong>{warning.title}</strong><small>{consistencyCategoryLabels[warning.category]} · {warning.detail}</small><p>{warning.recommendation}</p></div>
                {warning.category === 'DOCUMENT' && <button type="button" className="link-button" onClick={() => setTab('documents')}>Revisar</button>}
              </article>)}
            </div>}
          </section>

          <form className="card form-card" onSubmit={patchMatter}>
            <div className="section-heading"><div><h2>Inmuebles y relación</h2><p>Bien arrendado, garantía y expediente origen.</p></div><button className="button text" disabled={busy}>Guardar</button></div>
            <div className="form-grid">
              <label>Inmueble principal<select name="propertyId" defaultValue={matter.propertyId || ''}><option value="">Sin asignar</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.displayName}</option>)}</select></label>
              <label>Inmueble en garantía<select name="guaranteePropertyId" defaultValue={matter.guaranteePropertyId || ''}><option value="">Sin asignar</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.displayName}</option>)}</select></label>
            </div>
          </form>

          <section className="card">
            <div className="section-heading"><div><h2>Partes</h2><p>Los roles se reutilizan al generar contrato y convenio.</p></div></div>
            <div className="party-list">{matter.parties.map((party) => <article key={party.id}><div className="avatar">{party.person.legalName.slice(0, 1)}</div><div><strong>{party.person.legalName}</strong><span>{roleLabels[party.role] || party.role}</span></div></article>)}</div>
            <form className="inline-form" onSubmit={(event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); void action(`/matters/${id}/parties`, data); event.currentTarget.reset(); }}>
              <select name="personId" required><option value="">Selecciona persona</option>{people.map((person) => <option key={person.id} value={person.id}>{person.legalName}</option>)}</select>
              <select name="role" required><option value="LANDLORD">Arrendador/a</option><option value="TENANT">Arrendatario/a</option><option value="GUARANTOR">Obligado solidario</option></select>
              <button className="button secondary" disabled={busy}>Agregar</button>
            </form>
            {people.length === 0 && <p className="form-hint">Primero registra personas en el <Link href="/directorio">Directorio</Link>.</p>}
          </section>

          {matter.kind === 'LEASE' ? <form className="card form-card" onSubmit={saveLeaseTerms}>
            <div className="section-heading"><div><h2>Condiciones del arrendamiento</h2><p>Variables económicas y de vigencia detectadas en la plantilla.</p></div></div>
            <div className="form-grid three">
              <label>Renta mensual<input name="rentAmount" type="number" min="0" step="0.01" required defaultValue={String(matter.leaseTerms?.rentAmount ?? '')} /></label><label>Depósito<input name="depositAmount" type="number" min="0" step="0.01" defaultValue={String(matter.leaseTerms?.depositAmount ?? '')} /></label><label>Renta anticipada<input name="prepaidRentAmount" type="number" min="0" step="0.01" defaultValue={String(matter.leaseTerms?.prepaidRentAmount ?? '')} /></label>
              <label>Inicio<input name="startDate" type="date" required defaultValue={String(matter.leaseTerms?.startDate ?? '').slice(0, 10)} /></label><label>Fin<input name="endDate" type="date" required defaultValue={String(matter.leaseTerms?.endDate ?? '').slice(0, 10)} /></label><label>Duración (meses)<input name="durationMonths" type="number" defaultValue={String(matter.leaseTerms?.durationMonths ?? 12)} /></label>
              <label>Día límite de pago<input name="dueDay" type="number" min="1" max="31" defaultValue={String(matter.leaseTerms?.dueDay ?? 5)} /></label><label className="span-two">Forma / cuenta de pago<input name="paymentMethod" defaultValue={String(matter.leaseTerms?.paymentMethod ?? '')} /></label>
            </div><div className="form-actions"><button className="button primary" disabled={busy}>Guardar condiciones</button></div>
          </form> : <form className="card form-card" onSubmit={saveMediation}>
            <div className="section-heading"><div><h2>Datos del convenio</h2><p>Control del expediente y de la audiencia de mediación.</p></div></div>
            <div className="form-grid three"><label>Número de convenio<input name="agreementNumber" required defaultValue={String(matter.mediationTerms?.agreementNumber ?? '')} /></label><label>Número de expediente<input name="caseFileNumber" required defaultValue={String(matter.mediationTerms?.caseFileNumber ?? '')} /></label><label>Fecha y hora<input name="hearingAt" required type="datetime-local" defaultValue={String(matter.mediationTerms?.hearingAt ?? '').slice(0, 16)} /></label><label className="span-two">Nombre del centro<input name="centerName" required defaultValue={String(matter.mediationTerms?.centerName ?? '')} /></label><label>Acreditación del centro<input name="centerAccreditationNumber" required defaultValue={String(matter.mediationTerms?.centerAccreditationNumber ?? '')} /></label><label className="span-two">Facilitador/a<input name="facilitatorName" required defaultValue={String(matter.mediationTerms?.facilitatorName ?? '')} /></label><label>Certificación<input name="facilitatorCertification" required defaultValue={String(matter.mediationTerms?.facilitatorCertification ?? '')} /></label><label>Copias certificadas<input name="certifiedCopies" type="number" min="1" required defaultValue={String(matter.mediationTerms?.certifiedCopies ?? 3)} /></label></div>
            <div className="form-actions"><button className="button primary" disabled={busy}>Guardar datos</button></div>
          </form>}
        </div>

        <aside className="detail-side">
          {canManageChecklist && <form className="card form-card" onSubmit={assignResponsible}>
            <div className="section-heading"><div><h2>Responsable</h2><p>Propietario operativo del expediente y sus automatizaciones.</p></div></div>
            <label>Integrante<select name="responsibleMembershipId" required defaultValue={matter.responsible?.id ?? ''}><option value="" disabled>Selecciona responsable</option>{taskAssignees.filter((assignee) => ['ADMIN', 'LAWYER', 'OPERATOR'].includes(assignee.role)).map((assignee) => <option value={assignee.id} key={assignee.id}>{assignee.user.displayName} · {assignee.role}</option>)}</select></label>
            <button className="button secondary wide" disabled={busy}>Actualizar responsable</button>
            <p className="form-hint">Las tareas automáticas abiertas y recordatorios pendientes se reasignan; las tareas manuales conservan su responsable.</p>
          </form>}
          <section className="card"><div className="section-heading"><div><h2>Checklist</h2><p>{matter.checklistItems.filter((item) => item.status === 'PENDING').length} pendiente(s)</p></div><div className="ring" style={{ '--progress': `${completion * 3.6}deg` } as React.CSSProperties}><span>{completion}%</span></div></div><div className="checklist">{matter.checklistItems.map((item) => <div className={`check ${item.status === 'COMPLETE' ? 'complete' : item.status === 'WAIVED' ? 'waived' : ''}`} key={item.id}><span>{item.status === 'COMPLETE' ? '✓' : item.status === 'WAIVED' ? '≈' : item.blocking ? '!' : '○'}</span><div><strong>{item.label}</strong><small>{item.status === 'WAIVED' ? `Dispensado: ${item.waivedReason}` : `${item.blocking ? 'Requisito bloqueante' : 'Recomendado'} · ${item.completionMode === 'MANUAL' ? 'Confirmación manual' : 'Validación automática'}`}</small></div><div className="check-actions">{item.completionMode === 'MANUAL' && canManageChecklist && item.status !== 'WAIVED' && <button type="button" className="link-button" disabled={busy} onClick={() => void setManualChecklistStatus(item.id, item.status === 'COMPLETE' ? 'PENDING' : 'COMPLETE')}>{item.status === 'COMPLETE' ? 'Reabrir' : 'Marcar completo'}</button>}{item.status === 'PENDING' && canAdvance && <button type="button" className="link-button" disabled={busy} onClick={() => void waiveChecklistItem(item.id)}>Dispensar</button>}</div></div>)}</div></section>

          {['ADMIN', 'LAWYER', 'OPERATOR'].includes(sessionRole) && <section className="card form-card portal-admin-panel">
            <div className="section-heading"><div><h2>Portal del cliente</h2><p>Captura y archivos sujetos a aprobación interna.</p></div></div>
            <form className="portal-invitation-form" onSubmit={createPortalInvitation}>
              <label>Rol<select name="partyRole" required defaultValue={matter.kind === 'LEASE' ? 'TENANT' : 'COMPLEMENTARY_PARTY'}>{matter.kind === 'LEASE' ? <><option value="LANDLORD">Arrendador/a</option><option value="TENANT">Arrendatario/a</option><option value="GUARANTOR">Obligado solidario</option></> : <><option value="REQUESTING_PARTY">Parte solicitante</option><option value="COMPLEMENTARY_PARTY">Parte complementaria</option><option value="GUARANTOR">Obligado solidario</option></>}</select></label>
              <label>Persona existente<select name="personId" defaultValue=""><option value="">Registrar una nueva</option>{people.map((person) => <option key={person.id} value={person.id}>{person.legalName}</option>)}</select></label>
              <label>Correo de referencia<input name="invitedEmail" type="email" placeholder="cliente@ejemplo.com" /></label>
              <label>Vigencia<select name="expiresInDays" defaultValue="7"><option value="3">3 días</option><option value="7">7 días</option><option value="15">15 días</option><option value="30">30 días</option></select></label>
              <button className="button secondary wide" disabled={busy}>Crear enlace seguro</button>
            </form>
            {portalLink && <div className="portal-created-link"><strong>Enlace mostrado una sola vez</strong><input readOnly value={portalLink} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="button text" onClick={() => void copyPortalLink()}>Copiar enlace</button></div>}
            <div className="portal-invitation-list">{portalInvitations.map((invitation) => <article key={invitation.id}>
              <div><strong>{roleLabels[invitation.partyRole] ?? invitation.partyRole}</strong><small>{invitation.invitedPerson?.legalName ?? invitation.invitedEmail ?? 'Persona por registrar'} · vence {new Date(invitation.expiresAt).toLocaleDateString('es-MX')}</small></div><span className={`tag portal-${invitation.effectiveStatus.toLowerCase()}`}>{portalStatusLabels[invitation.effectiveStatus]}</span>
              {invitation.submission?.personData && <div className="portal-captured-data"><strong>{invitation.submission.personData.legalName}</strong><span>{[invitation.submission.personData.email, invitation.submission.personData.phone, invitation.submission.personData.taxId].filter(Boolean).join(' · ')}</span></div>}
              {invitation.submission?.uploads.length ? <div className="portal-captured-files">{invitation.submission.uploads.map((file) => <button type="button" className="link-button" key={file.id} onClick={() => void downloadPortalUpload(file.id, file.originalName)}>{file.originalName}</button>)}</div> : null}
              {invitation.effectiveStatus === 'PENDING_REVIEW' && invitation.submission && <div className="review-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => void reviewPortalSubmission(invitation.submission!.id, 'reject')}>Solicitar ajustes</button><button type="button" className="button primary" disabled={busy} onClick={() => void reviewPortalSubmission(invitation.submission!.id, 'accept')}>Incorporar</button></div>}
              {['DRAFT', 'REJECTED'].includes(invitation.effectiveStatus) && <button type="button" className="link-button" disabled={busy} onClick={() => void revokePortalInvitation(invitation.id)}>Revocar acceso</button>}
              {invitation.submission?.reviewComment && <p>{invitation.submission.reviewComment}</p>}
            </article>)}</div>
          </section>}

          {matter.kind === 'LEASE' && ['ACTIVE', 'RENEWAL_DUE'].includes(matter.status) && <section className="card form-card renewal-panel">
            <div className="section-heading"><div><h2>Renovación</h2><p>Abre un expediente relacionado sin recapturar partes ni condiciones.</p></div></div>
            {matter.renewal && <div className="renewal-countdown"><strong>{new Date(matter.renewal.endDate).toLocaleDateString('es-MX')}</strong><span>{matter.renewal.daysRemaining < 0 ? `Venció hace ${Math.abs(matter.renewal.daysRemaining)} días` : `${matter.renewal.daysRemaining} días restantes`}</span></div>}
            {matter.openRenewal ? <div className="alert info">Ya existe la renovación <Link className="link-button" href={`/expedientes/${matter.openRenewal.id}`}>{matter.openRenewal.reference}</Link>.</div> : canAdvance && renewalDefaults ? <form onSubmit={createRenewal}>
              <div className="form-grid">
                <label>Inicio<input name="startDate" type="date" required defaultValue={renewalDefaults.startDate} /></label>
                <label>Fin<input name="endDate" type="date" required defaultValue={renewalDefaults.endDate} /></label>
                <label>Duración (meses)<input name="durationMonths" type="number" min="1" required defaultValue={renewalDefaults.durationMonths} /></label>
                <label>Nueva renta<input name="rentAmount" type="number" min="0" step="0.01" defaultValue={String(matter.leaseTerms?.rentAmount ?? '')} /></label>
                <label className="full">Notas<textarea name="notes" rows={3} maxLength={2000} placeholder="Condiciones por confirmar…" /></label>
              </div>
              <button className="button primary wide" disabled={busy}>Iniciar renovación</button>
              <p className="form-hint">Se reutilizan inmueble, partes y condiciones. Los documentos deberán confirmarse en el nuevo checklist.</p>
            </form> : <p className="form-hint">La renovación requiere un perfil jurídico o administrador.</p>}
          </section>}

          {(['ACTIVE', 'RENEWAL_DUE', 'TERMINATION', 'CLOSED'].includes(matter.status) || matter.terminationProcesses.length > 0) && <section className="card form-card termination-panel">
            <div className="section-heading"><div><h2>Terminación y cierre</h2><p>El cierre requiere motivo y evidencia documental.</p></div></div>
            {completedTermination && <>
              <div className="signature-summary complete"><span>✓</span><div><strong>Expediente cerrado</strong><small>{completedTermination.closureReason} · {completedTermination.closedBy?.displayName}</small></div></div>
              {completedTermination.evidenceDocument && <button type="button" className="button secondary wide" onClick={() => void downloadDocument(completedTermination.evidenceDocument!.id)}>Descargar evidencia de cierre</button>}
            </>}

            {['ACTIVE', 'RENEWAL_DUE'].includes(matter.status) && matter.openRenewal && <div className="alert info">Cancela o concluye la renovación {matter.openRenewal.reference} antes de iniciar una terminación.</div>}
            {['ACTIVE', 'RENEWAL_DUE'].includes(matter.status) && !matter.openRenewal && !openTermination && canAdvance && <form className="signature-complete-form" onSubmit={startTermination}>
              <label>Motivo de terminación<textarea name="reason" rows={4} minLength={10} maxLength={2000} required placeholder="Describe la causa y el contexto…" /></label>
              <label>Fecha efectiva prevista<input name="effectiveDate" type="date" /></label>
              <button className="button secondary wide" disabled={busy}>Iniciar terminación</button>
            </form>}

            {openTermination && <>
              <div className="signature-summary pending"><span>!</span><div><strong>Terminación en proceso</strong><small>{openTermination.reason} · iniciada por {openTermination.startedBy.displayName}</small></div></div>
              <form className="signature-complete-form" onSubmit={completeTermination}>
                <label>Fecha de cierre<input name="closedAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                <label>Evidencia<input name="file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.heic" required /></label>
                <label>Conclusión<textarea name="comment" rows={4} minLength={10} maxLength={2000} required placeholder="Describe el resultado y obligaciones concluidas…" /></label>
                <button className="button primary wide" disabled={busy}>Registrar evidencia y cerrar</button>
                <button type="button" className="button text wide" disabled={busy} onClick={() => void cancelTermination(openTermination.id)}>Cancelar terminación</button>
              </form>
            </>}

            {matter.terminationProcesses.length > 0 && <div className="signature-history">
              {matter.terminationProcesses.map((process) => <div key={process.id}><span className={`tag termination-${process.status.toLowerCase()}`}>{terminationStatusLabels[process.status]}</span><small>{new Date(process.startedAt).toLocaleString('es-MX')} · {process.startedBy.displayName}</small><p>{process.status === 'CANCELLED' ? process.cancellationReason : process.status === 'COMPLETED' ? process.closureReason : process.reason}</p></div>)}
            </div>}
            {['ACTIVE', 'RENEWAL_DUE', 'TERMINATION'].includes(matter.status) && !canAdvance && <p className="form-hint">La terminación requiere un perfil jurídico o administrador.</p>}
          </section>}
        </aside>
      </div>}

      {tab === 'documents' && <div className="detail-layout">
        <div className="document-top-actions">
          <form className="card form-card batch-upload-panel" onSubmit={uploadBatch}>
            <div className="section-heading"><div><h2>Carga documental múltiple</h2><p>Clasifica cada archivo antes de incorporarlo al expediente.</p></div><span className="tag">{batchRows.length}/10</span></div>
            <div className="identity-upload-consent document-reading-choice"><label>Lectura al guardar<select value={uploadReadingMode} disabled={busy} onChange={(event) => setUploadReadingMode(event.target.value as typeof uploadReadingMode)}><option value="none">Guardar sin leer</option><option value="local">Leer localmente (sin IA)</option>{extractionSettings?.enabled && <option value="ai">Leer con IA</option>}</select></label><p>{uploadReadingMode === 'local'
              ? 'Se extraerá el texto de PDF, JPG y PNG en el servidor de la aplicación, sin enviarlos a un modelo de IA. Podrás revisar y copiar el texto; los campos se capturan manualmente.'
              : uploadReadingMode === 'ai'
                ? `Las identificaciones de arrendador, arrendatario y obligado solidario se enviarán a ${extractionSettings?.provider} y generarán consumo. Revisarás los datos antes de modificar una ficha.`
                : 'Se conservarán los archivos originales sin leer su contenido. Podrás solicitar una lectura o capturar datos manualmente después.'}</p></div>
            <label>Seleccionar archivos<input key={filePickerKey} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.heic" onChange={(event) => selectBatchFiles(event.target.files)} /></label>
            {batchRows.length > 0 && <div className="batch-upload-list">
              {batchRows.map((row, index) => <article className={row.error ? 'has-error' : ''} key={row.id}>
                <div className="batch-file-heading">
                  <span className="file-icon">{row.file.type === 'application/pdf' ? 'PDF' : 'DOC'}</span>
                  <div><strong>{row.file.name}</strong><small>{(row.file.size / 1024).toFixed(0)} KB · archivo {index + 1}</small></div>
                  <button type="button" className="link-button danger" disabled={busy} onClick={() => setBatchRows((current) => current.filter((item) => item.id !== row.id))}>Quitar</button>
                </div>
                <div className="batch-file-fields">
                  <label>Tipo documental<select required value={row.type} onChange={(event) => changeBatchType(row.id, event.target.value)}>{uploadableDocumentTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                  <label>Persona relacionada<select value={row.personId} onChange={(event) => updateBatchRow(row.id, { personId: event.target.value })}><option value="">Sin persona</option>{people.map((person) => <option value={person.id} key={person.id}>{person.legalName}</option>)}</select></label>
                  <label>Inmueble relacionado<select value={row.propertyId} onChange={(event) => updateBatchRow(row.id, { propertyId: event.target.value })}><option value="">Sin inmueble</option>{properties.map((property) => <option value={property.id} key={property.id}>{property.displayName}</option>)}</select></label>
                  <label>Fecha de emisión<input type="date" value={row.issuedAt} onChange={(event) => updateBatchRow(row.id, { issuedAt: event.target.value })} /></label>
                  <label>Fecha de vencimiento<input type="date" value={row.expiresAt} onChange={(event) => updateBatchRow(row.id, { expiresAt: event.target.value })} /></label>
                </div>
                {row.error && <p className="batch-file-error">{row.error}</p>}
              </article>)}
            </div>}
            {batchResult && <div className={`batch-result ${batchResult.failed ? 'partial' : 'complete'}`}>
              <strong>{batchResult.succeeded} de {batchResult.total} archivo(s) guardados</strong>
              <small>{batchResult.failed ? `${batchResult.failed} requieren corrección y permanecen en la lista.` : 'El lote se incorporó por completo.'}</small>
              <div>{batchResult.results.map((result) => <span className={`tag ${result.status === 'SUCCESS' ? 'batch-success' : 'batch-failed'}`} key={`${result.index}-${result.originalName}`}>{result.status === 'SUCCESS' ? '✓' : '!'} {result.originalName}{result.document ? ` · v${result.document.version}` : ''}</span>)}</div>
            </div>}
            {extractionProgress && <p className="identity-extraction-progress" role="status" aria-live="polite">{extractionProgress} El archivo ya está guardado; todavía no se ha modificado ninguna ficha.</p>}
            {identityExtractions.length > 0 && <div className="identity-upload-results">{identityExtractions.map((reading) => <div key={reading.documentId}><strong>{reading.name}</strong><span>{reading.status === 'MANUAL_REVIEW' ? 'Datos listos para revisar. La ficha aún no cambió.' : reading.message}</span>{reading.status === 'MANUAL_REVIEW' && <Link className="link-button" href={`/extracciones?documentId=${encodeURIComponent(reading.documentId)}`}>Revisar datos extraídos</Link>}</div>)}</div>}
            <button className="button primary wide" disabled={busy || batchRows.length === 0}>{busy ? extractionProgress || 'Guardando lote…' : `Guardar ${batchRows.length || ''} documento(s)`}</button>
            <p className="form-hint">Máximo 10 archivos y 20 MB por archivo. Cada resultado conserva su versión y auditoría; los errores no revierten las cargas correctas. Word y HEIC se guardan sin lectura.{!extractionSettings?.enabled && ' La lectura con IA está deshabilitada.'}</p>
          </form>
          {matter.kind === 'LEASE' ? <form className="card form-card" onSubmit={generateLeaseDraft}>
            <div className="section-heading"><div><h2>Generar contrato</h2><p>Plantilla jurídica v1 sin IA.</p></div></div>
            <label>Fecha de celebración<input name="executionDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <button className="button primary wide" disabled={busy || !canAdvance || !['READY_TO_DRAFT', 'DRAFTING'].includes(matter.status)}>Generar DOCX</button>
            <p className="form-hint">Genera una nueva versión en elaboración y envíala después a revisión.</p>
          </form> : <form className="card form-card" onSubmit={generateAgreementDraft}>
            <div className="section-heading"><div><h2>Generar convenio</h2><p>Plantilla jurídica v1 sin IA.</p></div></div>
            <label>Fecha de celebración del arrendamiento<input name="leaseExecutionDate" type="date" required /></label>
            <button className="button primary wide" disabled={busy || !canAdvance || !['READY_TO_DRAFT', 'DRAFTING'].includes(matter.status)}>Generar DOCX</button>
            <p className="form-hint">Genera una nueva versión en elaboración y envíala después a revisión.</p>
          </form>}
        </div>
        <div className="detail-main">
          <section className="card">
            <div className="section-heading"><div><h2>Documentos del expediente</h2><p>La versión vigente participa en alertas y checklist; las históricas permanecen descargables.</p></div><Link className="button secondary" href={`/biblioteca?matterId=${encodeURIComponent(matter.id)}`}>Biblioteca jurídica</Link></div>
            <p className="form-hint">Eliminar borra una carga definitivamente; Invalidar conserva el archivo. Los contratos controlados y las evidencias vinculadas a otros procesos están protegidos.</p>
            <div className="document-list">
              {matter.documents.map((document) => {
                const lastReview = document.reviews[0];
                const pdfDerivative = document.type === 'DRAFT_CONTRACT'
                  ? matter.documents.find((candidate) => (
                    candidate.sourceDocumentId === document.id
                    && candidate.type === 'DRAFT_CONTRACT_PDF'
                  ))
                  : undefined;
                return <article className={document.invalidatedAt ? 'document-invalidated' : !document.isCurrentVersion ? 'document-historical' : undefined} key={document.id}>
                  <span className="file-icon">{document.mimeType === 'application/pdf' ? 'PDF' : 'DOC'}</span>
                  <div><strong>{document.originalName}</strong><small>{document.libraryLinks?.[0]?.libraryDocument.documentTypeLabel ?? docLabels[document.type] ?? document.type} · v{document.version} · {(document.sizeBytes / 1024).toFixed(0)} KB{document.sourceDocument ? ` · deriva de ${document.sourceDocument.originalName}` : ''}{document.expiresAt ? ` · vence ${new Date(document.expiresAt).toLocaleDateString('es-MX', { timeZone: 'UTC' })}` : ''}</small>{document.libraryLinks?.map(({ libraryDocument }) => <small key={libraryDocument.id}><Link className="link-button" href={`/biblioteca?documentId=${encodeURIComponent(libraryDocument.id)}&matterId=${encodeURIComponent(matter.id)}`}>Referencia de {libraryDocument.source} · {libraryDocument.packageLabel}</Link></small>)}{document.invalidatedAt && <small className="document-invalidation-reason">Retirado por {document.invalidatedBy?.displayName ?? 'usuario no disponible'}: {document.invalidationReason}</small>}</div>
                  <div className="document-actions">
                    <span className={`tag${document.invalidatedAt ? ' invalidated' : !document.isCurrentVersion ? ' historical' : ''}`}>{document.invalidatedAt ? 'Invalidado' : !document.isCurrentVersion ? 'Histórica' : document.type === 'DRAFT_CONTRACT' ? lastReview ? reviewDecisionLabels[lastReview.decision] : pdfDerivative ? 'PDF verificado' : 'PDF pendiente' : document.type === 'DRAFT_CONTRACT_PDF' ? 'Derivado inmutable' : document.extractionStatus === 'NOT_REQUESTED' ? 'Captura manual' : document.extractionStatus}</span>
                    {document.type === 'DRAFT_CONTRACT' && document.version > 1 && <button type="button" className="link-button" disabled={busy} onClick={() => void compareDocument(document.id)}>Comparar anterior</button>}
                    {document.type === 'DRAFT_CONTRACT' && !pdfDerivative && canAdvance && <button type="button" className="link-button" disabled={busy} onClick={() => void generatePdfPreview(document.id)}>Generar PDF</button>}
                    {document.type === 'DRAFT_CONTRACT' && pdfDerivative && <button type="button" className="link-button" disabled={busy} onClick={() => void previewDocument(pdfDerivative.id, pdfDerivative.originalName)}>Vista previa</button>}
                    {document.mimeType === 'application/pdf' && <button type="button" className="link-button" disabled={busy} onClick={() => void previewDocument(document.id, document.originalName)}>Vista previa</button>}
                    {canManageChecklist && !document.invalidatedAt && uploadableDocumentTypes.some(([type]) => type === document.type) && <button type="button" className="link-button" disabled={busy} onClick={() => setClassificationDraft({ documentId: document.id, type: document.type, personId: document.personId ?? '', propertyId: document.propertyId ?? '' })}>Corregir clasificación</button>}
                    {canManageChecklist && !document.invalidatedAt && uploadableDocumentTypes.some(([type]) => type === document.type) && document.extractionStatus !== 'PROCESSING' && <select className="document-reading-action" aria-label={`Lectura de ${document.originalName}`} disabled={busy} value="" onChange={(event) => { if (event.target.value) void requestDocumentExtraction(document.id, event.target.value as 'local' | 'ai' | 'manual'); }}><option value="" disabled>Leer o capturar…</option><option value="local">Leer localmente (sin IA)</option>{extractionSettings?.enabled && IDENTITY_DOCUMENT_TYPES.includes(document.type) && <option value="ai">Leer con IA</option>}<option value="manual">Capturar manualmente</option></select>}
                    {canManageChecklist && !document.invalidatedAt && ['MANUAL_REVIEW', 'PROCESSING'].includes(document.extractionStatus) && <button type="button" className="link-button" disabled={busy} onClick={() => router.push(`/extracciones?documentId=${encodeURIComponent(document.id)}`)}>Revisar extracción</button>}
                    {canManageChecklist && !document.invalidatedAt && uploadableDocumentTypes.some(([type]) => type === document.type) && <button type="button" className="link-button danger" disabled={busy} onClick={() => void invalidateDocument(document.id)}>Invalidar</button>}
                    {canManageChecklist && document.invalidatedAt && <button type="button" className="link-button" disabled={busy} onClick={() => void restoreDocument(document.id)}>Restaurar</button>}
                    <button type="button" className="link-button" onClick={() => void downloadDocument(document.id)}>Descargar</button>
                    {canManageChecklist && <DeleteDocumentButton document={document} matterStatus={matter.status} disabled={busy} onBusyChange={setBusy} onError={setError} onDeleted={async (documentId) => {
                      setIdentityExtractions((current) => current.filter((reading) => reading.documentId !== documentId));
                      setClassificationDraft((current) => current?.documentId === documentId ? undefined : current);
                      setPdfPreview((current) => current?.documentId === documentId ? undefined : current);
                      await load();
                      setDocumentNotice('Archivo eliminado definitivamente. La operación quedó registrada en la bitácora.');
                    }} />}
                  </div>
                  {!document.invalidatedAt && uploadableDocumentTypes.some(([type]) => type === document.type) && <details className="document-insight-tools">
                    <summary>Analizar clasificación</summary>
                    <DocumentInsights kind="classification" documentId={document.id} revision={insightRevision} settings={insightSettings} settingsError={insightSettingsError} disabled={busy} onUseSuggestion={canManageChecklist ? (type) => setClassificationDraft((current) => ({
                      documentId: document.id,
                      type,
                      personId: current?.documentId === document.id ? current.personId : document.personId ?? '',
                      propertyId: current?.documentId === document.id ? current.propertyId : document.propertyId ?? '',
                    })) : undefined} />
                  </details>}
                  {classificationDraft?.documentId === document.id && <form className="document-classification-editor" onSubmit={saveDocumentClassification}>
                    <div><strong>Corregir clasificación</strong><small>El archivo y su checksum permanecen intactos. Cambiar de tipo asigna la siguiente versión disponible.</small></div>
                    <label>Tipo<select value={classificationDraft.type} onChange={(event) => setClassificationDraft((current) => current ? { ...current, type: event.target.value } : current)}>{uploadableDocumentTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                    <label>Persona<select value={classificationDraft.personId} onChange={(event) => setClassificationDraft((current) => current ? { ...current, personId: event.target.value } : current)}><option value="">Sin persona</option>{people.map((person) => <option value={person.id} key={person.id}>{person.legalName}</option>)}</select></label>
                    <label>Inmueble<select value={classificationDraft.propertyId} onChange={(event) => setClassificationDraft((current) => current ? { ...current, propertyId: event.target.value } : current)}><option value="">Sin inmueble</option>{properties.map((property) => <option value={property.id} key={property.id}>{property.displayName}</option>)}</select></label>
                    <div className="document-classification-actions"><button className="button primary" disabled={busy}>Guardar corrección</button><button type="button" className="button text" disabled={busy} onClick={() => setClassificationDraft(undefined)}>Cancelar</button></div>
                  </form>}
                  {document.clauseSnapshots.length > 0 && <div className="document-clause-snapshots">
                    <small>Cláusulas incorporadas</small>
                    <div>{document.clauseSnapshots.map((snapshot) => <span className="tag" key={snapshot.id}>{snapshot.code} · v{snapshot.clauseVersionNumber}</span>)}</div>
                  </div>}
                  {document.reviews.length > 0 && <div className="document-review-history">
                    {document.reviews.map((review) => <div key={review.id}>
                      <strong>{reviewDecisionLabels[review.decision]}</strong>
                      <span>{review.comment}</span>
                      <small>{review.reviewer.displayName} · {new Date(review.createdAt).toLocaleString('es-MX')}</small>
                    </div>)}
                  </div>}
                </article>;
              })}
              {matter.documents.length === 0 && <div className="empty"><strong>Sin documentos</strong><span>Carga la primera evidencia del expediente.</span></div>}
            </div>
          </section>

          {pdfPreview && <section className="card pdf-preview-panel">
            <div className="section-heading"><div><h2>Vista previa PDF</h2><p>{pdfPreview.name}</p></div><div className="heading-actions"><button type="button" className="link-button" onClick={() => void downloadDocument(pdfPreview.documentId)}>Descargar</button><button type="button" className="link-button" onClick={() => setPdfPreview(undefined)}>Cerrar</button></div></div>
            <iframe src={pdfPreview.url} title={`Vista previa de ${pdfPreview.name}`} />
          </section>}

          {comparison && <section className="card comparison-panel">
            <div className="section-heading"><div><h2>Comparación de versiones</h2><p>v{comparison.previousDocument.version} contra v{comparison.currentDocument.version}, por párrafo.</p></div><button type="button" className="link-button" onClick={() => setComparison(undefined)}>Cerrar</button></div>
            {comparison.changes.length === 0 ? <div className="alert info">No se detectaron cambios en el texto de los párrafos.</div> : <div className="diff-list">
              {comparison.changes.map((change) => <div className="diff-row" key={change.paragraph}>
                <strong>Párrafo {change.paragraph}</strong>
                <div><small>Versión anterior</small><p>{change.before || '—'}</p></div>
                <div><small>Versión actual</small><p>{change.after || '—'}</p></div>
              </div>)}
            </div>}
            <div className="comparison-insights"><DocumentInsights key={`${comparison.currentDocument.id}:${comparison.previousDocument.id}`} kind="comparison" documentId={comparison.currentDocument.id} revision={`${insightRevision}:${comparison.previousDocument.id}`} settings={insightSettings} settingsError={insightSettingsError} disabled={busy} /></div>
          </section>}
        </div>

        <aside className="detail-side">
          {(matter.status === 'SIGNATURE' || matter.signatureRequests.length > 0) && <section className="card form-card signature-panel">
            <div className="section-heading"><div><h2>Firma y activación</h2><p>Control manual preparado para conectar un proveedor externo.</p></div></div>
            {completedSignature && <div className="signature-summary complete">
              <span>✓</span>
              <div><strong>Contrato firmado y expediente activo</strong><small>Firmado el {new Date(completedSignature.signedAt!).toLocaleDateString('es-MX')} · registrado por {completedSignature.completedBy?.displayName}</small></div>
            </div>}
            {completedSignature?.signedDocument && <button type="button" className="button secondary wide" onClick={() => void downloadDocument(completedSignature.signedDocument!.id)}>Descargar contrato firmado</button>}

            {matter.status === 'SIGNATURE' && !pendingSignature && !completedSignature && canAdvance && <>
              <div className="signature-summary"><span>1</span><div><strong>Preparar solicitud manual</strong><small>Usará la última versión con aprobación final.</small></div></div>
              <button type="button" className="button primary wide" disabled={busy} onClick={() => void action(`/matters/${id}/signatures`, {})}>Iniciar firma</button>
            </>}

            {pendingSignature && <>
              <div className="signature-summary pending"><span>…</span><div><strong>{signatureStatusLabels[pendingSignature.status]}</strong><small>{pendingSignature.sourceDocument.originalName} · solicitada por {pendingSignature.requestedBy.displayName}</small></div></div>
              <form className="signature-complete-form" onSubmit={completeSignature}>
                <label>Fecha de firma<input name="signedAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                <label>Contrato firmado<input name="file" type="file" accept=".pdf,.doc,.docx" required /></label>
                <label>Notas<textarea name="notes" rows={3} maxLength={2000} placeholder="Observaciones o referencia del proceso…" /></label>
                <button className="button primary wide" disabled={busy}>Registrar firma y activar</button>
                <button type="button" className="button text wide" disabled={busy} onClick={() => void cancelSignature(pendingSignature.id)}>Cancelar solicitud</button>
              </form>
            </>}

            {matter.signatureRequests.length > 0 && <div className="signature-history">
              {matter.signatureRequests.map((request) => <div key={request.id}><span className={`tag signature-${request.status.toLowerCase()}`}>{signatureStatusLabels[request.status]}</span><small>{request.provider} · {new Date(request.requestedAt).toLocaleString('es-MX')}</small>{request.notes && <p>{request.notes}</p>}</div>)}
            </div>}
            {matter.status === 'SIGNATURE' && !canAdvance && <p className="form-hint">La gestión de firma requiere un perfil jurídico o administrador.</p>}
          </section>}

          {['REVIEW', 'APPROVAL'].includes(matter.status) && <section className="card form-card review-panel">
            <div className="section-heading"><div><h2>{matter.status === 'REVIEW' ? 'Revisión jurídica' : 'Aprobación final'}</h2><p>{latestDraft ? `${latestDraft.originalName} · v${latestDraft.version}` : 'No existe un borrador vigente.'}</p></div></div>
            <label>Comentario de la decisión<textarea rows={5} minLength={10} maxLength={2000} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="Explica la aprobación o los cambios requeridos…" /></label>
            {matter.status === 'REVIEW' && canReview && <div className="review-actions">
              <button type="button" className="button secondary" disabled={busy || !latestDraft} onClick={() => void reviewDocument('legal-changes')}>Solicitar cambios</button>
              <button type="button" className="button primary" disabled={busy || !latestDraft} onClick={() => void reviewDocument('legal-approve')}>Aprobar jurídicamente</button>
            </div>}
            {matter.status === 'APPROVAL' && canApprove && <div className="review-actions">
              <button type="button" className="button secondary" disabled={busy || !latestDraft} onClick={() => void reviewDocument('approval-changes')}>Solicitar cambios</button>
              <button type="button" className="button primary" disabled={busy || !latestDraft} onClick={() => void reviewDocument('final-approve')}>Aprobar para firma</button>
            </div>}
            {matter.status === 'APPROVAL' && !canApprove && <p className="form-hint">La aprobación final está reservada al perfil administrador.</p>}
            {matter.status === 'REVIEW' && !canReview && <p className="form-hint">La revisión requiere un perfil jurídico o administrador.</p>}
          </section>}

          {canAdvance && <section className="card form-card clause-selection-panel">
            <div className="section-heading"><div><h2>Cláusulas adicionales</h2><p>Se insertan antes de las firmas y quedan congeladas por versión.</p></div><Link className="link-button" href="/clausulas">Catálogo</Link></div>
            {clauseCatalog.length === 0 ? <p className="form-hint">No hay cláusulas aprobadas para este tipo de expediente.</p> : <div className="clause-choice-list">
              {clauseCatalog.map((clause) => {
                const approved = clause.versions.find((version) => version.status === 'APPROVED');
                const currentSelection = matter.clauseSelections.find((selection) => selection.clause.id === clause.id)?.clauseVersion;
                const options = [currentSelection, approved].filter((version, index, items) => (
                  version && items.findIndex((candidate) => candidate?.id === version.id) === index
                ));
                const selected = clauseChoices[clause.id];
                if (!approved && !currentSelection) return null;
                return <article key={clause.id}>
                  <label className="clause-choice-check"><input type="checkbox" checked={Boolean(selected)} onChange={(event) => setClauseChoices((current) => {
                    const next = { ...current };
                    if (event.target.checked) next[clause.id] = currentSelection?.id ?? approved!.id;
                    else delete next[clause.id];
                    return next;
                  })} /><span><strong>{clause.title}</strong><small>{clause.code}</small></span></label>
                  {selected && <select value={selected} onChange={(event) => setClauseChoices((current) => ({ ...current, [clause.id]: event.target.value }))}>{options.map((version) => <option value={version!.id} key={version!.id}>v{version!.version} · {version!.status === 'APPROVED' ? 'vigente' : 'seleccionada previamente'}</option>)}</select>}
                </article>;
              })}
            </div>}
            <button type="button" className="button secondary wide" disabled={busy || !['DRAFT', 'INTEGRATION', 'PENDING_CLIENT', 'VALIDATION', 'READY_TO_DRAFT', 'DRAFTING'].includes(matter.status)} onClick={() => void saveClauseSelection()}>Guardar selección</button>
            {!['DRAFT', 'INTEGRATION', 'PENDING_CLIENT', 'VALIDATION', 'READY_TO_DRAFT', 'DRAFTING'].includes(matter.status) && <p className="form-hint">La selección quedó bloqueada al entrar a revisión.</p>}
          </section>}

        </aside>
      </div>}

      {tab === 'tasks' && <div className="task-detail-layout">
        <section className="card">
          <div className="section-heading"><div><h2>Tareas del expediente</h2><p>Seguimiento manual y automatizaciones vinculadas al asunto.</p></div><span className="tag">{matter.tasks.filter((task) => !['DONE', 'CANCELLED'].includes(task.status)).length} abierta(s)</span></div>
          {matter.tasks.length === 0 ? <div className="empty"><strong>Sin tareas registradas</strong><span>Crea una actividad o deja que el flujo agregue tareas automáticas.</span></div> : <div className="task-list">
            {matter.tasks.map((task) => {
              const isOverdue = Boolean(task.dueAt && !['DONE', 'CANCELLED'].includes(task.status) && new Date(task.dueAt) < new Date());
              return <article className={`task-row ${isOverdue ? 'overdue' : ''}`} key={task.id}>
                <span className={`task-priority priority-${task.priority.toLowerCase()}`}>{task.priority.slice(0, 1)}</span>
                <div className="task-copy">
                  <strong>{task.title}</strong>
                  <small>{task.source === 'SYSTEM' ? 'Automática' : 'Manual'} · {task.assignee?.user.displayName ?? 'Sin responsable'}</small>
                  {task.description && <p>{task.description}</p>}
                  {task.status === 'BLOCKED' && task.blockedReason && <p className="task-block-reason"><strong>Bloqueo:</strong> {task.blockedReason}{task.blockedBy ? ` · ${task.blockedBy.displayName}` : ''}</p>}
                  {task.dueDateChanges.length > 0 && <details className="task-date-history"><summary>{task.dueDateChanges.length} reprogramación(es)</summary>{task.dueDateChanges.map((change) => <p key={change.id}><strong>{change.previousDueAt ? new Date(change.previousDueAt).toLocaleDateString('es-MX') : 'Sin fecha'} → {new Date(change.newDueAt).toLocaleDateString('es-MX')}</strong><span>{change.reason} · {change.changedBy.displayName} · {new Date(change.createdAt).toLocaleString('es-MX')}</span></p>)}</details>}
                  {task.comments.length > 0 && <details className="task-comments"><summary>{task.comments.length} nota(s) de seguimiento</summary>{task.comments.map((comment) => <p key={comment.id}><span>{comment.body}</span><small>{comment.author.displayName} · {new Date(comment.createdAt).toLocaleString('es-MX')}</small></p>)}</details>}
                  {task.evidenceLinks.length > 0 && <details className="task-evidence"><summary>{task.evidenceLinks.length} evidencia(s) documental(es)</summary>{task.evidenceLinks.map((link) => <div key={link.id}><button type="button" className="link-button" onClick={() => void downloadDocument(link.document.id)}>{link.document.originalName} · v{link.document.version}</button><small>{link.linkedBy.displayName} · {new Date(link.linkedAt).toLocaleString('es-MX')}{link.document.invalidatedAt ? ' · Invalidada' : ''}</small></div>)}</details>}
                  {task.prerequisites.length > 0 && <details className="task-dependencies"><summary>{task.prerequisites.length} prerrequisito(s)</summary>{task.prerequisites.map((dependency) => <div key={dependency.id}><div><strong>{dependency.dependsOnTask.title}</strong><small>{taskStatusLabels[dependency.dependsOnTask.status]} · agregado por {dependency.createdBy.displayName}</small></div>{canManageTasks && !isFinished && task.status === 'TODO' && <button type="button" className="link-button danger" disabled={busy} onClick={() => void removeTaskDependency(task.id, dependency.id)}>Quitar</button>}</div>)}</details>}
                  {canManageTasks && !isFinished && <div className="task-evidence-linker"><select aria-label={`Evidencia para ${task.title}`} value={taskEvidenceSelections[task.id] ?? ''} onChange={(event) => setTaskEvidenceSelections((current) => ({ ...current, [task.id]: event.target.value }))}><option value="">Seleccionar evidencia…</option>{evidenceDocuments.filter((document) => !task.evidenceLinks.some((link) => link.document.id === document.id)).map((document) => <option value={document.id} key={document.id}>{document.originalName} · v{document.version}</option>)}</select><button type="button" className="link-button" disabled={busy || !taskEvidenceSelections[task.id]} onClick={() => void linkTaskEvidence(task.id)}>Vincular</button></div>}
                  {canManageTasks && !isFinished && task.source === 'MANUAL' && task.status === 'TODO' && <div className="task-dependency-linker"><select aria-label={`Prerrequisito para ${task.title}`} value={taskDependencySelections[task.id] ?? ''} onChange={(event) => setTaskDependencySelections((current) => ({ ...current, [task.id]: event.target.value }))}><option value="">Agregar prerrequisito…</option>{matter.tasks.filter((candidate) => candidate.id !== task.id && candidate.source === 'MANUAL' && candidate.status !== 'CANCELLED' && !task.prerequisites.some((dependency) => dependency.dependsOnTask.id === candidate.id)).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.title} · {taskStatusLabels[candidate.status]}</option>)}</select><button type="button" className="link-button" disabled={busy || !taskDependencySelections[task.id]} onClick={() => void addTaskDependency(task.id)}>Agregar</button></div>}
                </div>
                <div className="task-meta"><div className="task-meta-tags"><span className={`tag task-${task.status.toLowerCase()}`}>{taskStatusLabels[task.status]}</span>{task.requiresEvidence && <span className="tag task-evidence-required">Evidencia obligatoria</span>}{task.prerequisites.some((dependency) => dependency.dependsOnTask.status !== 'DONE') && <span className="tag task-prerequisites-pending">Prerrequisitos pendientes</span>}</div><small className={isOverdue ? 'task-danger' : ''}>{task.dueAt ? `${isOverdue ? 'Venció' : 'Vence'} ${new Date(task.dueAt).toLocaleDateString('es-MX')}` : 'Sin fecha'} · {taskPriorityLabels[task.priority]}</small></div>
                {canManageTasks && !isFinished && <div className="task-actions"><button type="button" className="link-button" disabled={busy} onClick={() => void addTaskComment(task.id)}>Añadir nota</button>{task.source === 'MANUAL' && !['DONE', 'CANCELLED'].includes(task.status) && <button type="button" className="link-button" disabled={busy} onClick={() => void rescheduleTask(task.id, task.dueAt)}>Reprogramar</button>}{(taskActions[task.status] ?? []).filter((taskAction) => !(
                  task.deduplicationKey?.startsWith('document-validity:')
                  && ['DONE', 'CANCELLED'].includes(taskAction.status)
                )).map((taskAction) => <button type="button" className="link-button" disabled={busy} key={taskAction.status} onClick={() => void changeTaskStatus(task.id, taskAction.status)}>{taskAction.label}</button>)}</div>}
              </article>;
            })}
          </div>}
        </section>

        {canManageTasks && !isFinished && <form className="card form-card task-create-panel" onSubmit={createTask}>
          <div className="section-heading"><div><h2>Nueva tarea</h2><p>Si no eliges responsable se usará el del expediente.</p></div></div>
          <div className="form-grid">
            <label className="full">Título<input name="title" minLength={3} maxLength={160} required placeholder="Ej. Validar comprobante de domicilio" /></label>
            <label>Prioridad<select name="priority" defaultValue="NORMAL"><option value="LOW">Baja</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label>
            <label>Fecha límite<input name="dueAt" type="date" /></label>
            <label className="full">Responsable<select name="assigneeMembershipId" defaultValue=""><option value="">Responsable del expediente</option>{taskAssignees.map((assignee) => <option value={assignee.id} key={assignee.id}>{assignee.user.displayName} · {assignee.role}</option>)}</select></label>
            <label className="full">Descripción<textarea name="description" rows={4} maxLength={2000} placeholder="Resultado esperado, contexto o dependencia…" /></label>
            <label className="full task-requires-evidence"><input name="requiresEvidence" type="checkbox" /> Exigir evidencia documental antes de completar</label>
          </div>
          <button className="button primary wide" disabled={busy}>Crear tarea</button>
        </form>}
      </div>}

      {tab === 'activity' && <section className="card timeline"><div className="section-heading"><div><h2>Bitácora</h2><p>Registro cronológico e inmutable de acciones.</p></div></div>{matter.auditEvents.map((event) => <article key={event.id}><span></span><div><strong>{event.action.replaceAll('_', ' ')}</strong><small>{event.actor?.displayName ?? 'Sistema'} · {new Date(event.createdAt).toLocaleString('es-MX')}</small></div></article>)}</section>}
    </AppShell>
  );
}
