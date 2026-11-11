export interface Person {
  id: string;
  type: 'INDIVIDUAL' | 'COMPANY';
  legalName: string;
  givenName?: string;
  familyName?: string;
  gender?: string;
  nationality?: string;
  maritalStatus?: string;
  occupation?: string;
  taxId?: string;
  curp?: string;
  birthDate?: string;
  addressLine2?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  identificationType?: string;
  identificationNumber?: string;
}

export interface Property {
  id: string;
  displayName: string;
  useType: string;
  addressLine1: string;
  neighborhood?: string;
  city: string;
  state: string;
  postalCode?: string;
  registryReference?: string;
  ownershipEvidence?: string;
  ownerPersonId?: string;
  owner?: Pick<Person, 'id' | 'legalName'>;
}

export interface MatterPage {
  items: MatterSummary[];
  total: number;
  take: number;
  skip: number;
}

export interface MatterSummary {
  id: string;
  reference: string;
  title: string;
  kind: 'LEASE' | 'MEDIATION_AGREEMENT';
  status: string;
  cancelledAt?: string;
  cancellationReason?: string;
  cancelledBy?: { id: string; displayName: string };
  updatedAt: string;
  property?: Pick<Property, 'id' | 'displayName' | 'city' | 'state'>;
  responsible?: TaskAssignee;
  _count: { parties: number; documents: number; checklistItems: number };
  renewal?: RenewalAlert;
  openRenewal?: Pick<MatterSummary, 'id' | 'reference' | 'status'>;
}

export interface RenewalAlert {
  endDate: string;
  daysRemaining: number;
  level: 'NONE' | 'DUE_90' | 'DUE_60' | 'DUE_30' | 'DUE_15' | 'EXPIRED';
  thresholdDays: number | null;
}

export interface OperationsDashboard {
  asOf: string;
  metrics: {
    open: number;
    integration: number;
    signature: number;
    review: number;
    approval: number;
    active: number;
    termination: number;
    closed: number;
    renewalWindow: number;
    expired: number;
    averageDaysToActivation: number | null;
  };
  alerts: Array<{
    matterId: string;
    reference: string;
    title: string;
    status: string;
    property?: Pick<Property, 'id' | 'displayName' | 'city' | 'state'>;
    responsible?: { id: string; displayName: string };
    renewal: RenewalAlert;
    openRenewal?: Pick<MatterSummary, 'id' | 'reference' | 'status'>;
  }>;
}

export interface Reminder {
  id: string;
  matterId: string;
  type: 'RENEWAL';
  channel: 'IN_APP' | 'EMAIL' | 'CALENDAR';
  thresholdDays: number;
  scheduledFor: string;
  status: 'SCHEDULED' | 'DUE' | 'ACKNOWLEDGED' | 'CANCELLED';
  effectiveStatus: 'SCHEDULED' | 'DUE' | 'ACKNOWLEDGED' | 'CANCELLED';
  acknowledgedAt?: string;
  matter: {
    id: string;
    reference: string;
    title: string;
    status: string;
    property?: Pick<Property, 'id' | 'displayName'>;
  };
  recipient?: { id: string; displayName: string; email: string };
  acknowledgedBy?: { id: string; displayName: string };
}

export interface InboxNotification {
  id: string;
  matterId: string;
  taskId?: string;
  type: 'MATTER_ASSIGNED' | 'TASK_ASSIGNED' | 'TASK_ESCALATED' | 'TASK_COMMENTED';
  channel: 'IN_APP';
  scheduledFor: string;
  status: 'SCHEDULED' | 'DUE' | 'ACKNOWLEDGED' | 'CANCELLED';
  acknowledgedAt?: string;
  payload?: Record<string, unknown>;
  matter: { id: string; reference: string; title: string; status: string };
  task?: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueAt?: string;
    slaEscalationLevel: number;
  };
  acknowledgedBy?: { id: string; displayName: string };
}

export interface ClauseVersion {
  id: string;
  clauseId: string;
  version: number;
  body: string;
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  createdAt: string;
  approvedAt?: string;
  createdBy?: { id: string; displayName: string };
  approvedBy?: { id: string; displayName: string };
}

export interface Clause {
  id: string;
  code: string;
  title: string;
  category?: string;
  matterKind: 'LEASE' | 'MEDIATION_AGREEMENT';
  active: boolean;
  versions: ClauseVersion[];
  createdBy?: { id: string; displayName: string };
}

export interface RequirementDefinition {
  id: string;
  code: string;
  label: string;
  matterKind: 'LEASE' | 'MEDIATION_AGREEMENT';
  blocking: boolean;
  appliesToRole?: string;
  completionMode: 'AUTO' | 'MANUAL';
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalSearchResponse {
  query: string;
  resultCount: number;
  matters: SearchGroup<{
    id: string;
    reference: string;
    title: string;
    kind: 'LEASE' | 'MEDIATION_AGREEMENT';
    status: string;
    updatedAt: string;
    property?: Pick<Property, 'id' | 'displayName' | 'city' | 'state'>;
    responsible?: { user: { id: string; displayName: string } };
  }>;
  people: SearchGroup<{
    id: string;
    type: 'INDIVIDUAL' | 'COMPANY';
    legalName: string;
    taxId?: string;
    email?: string;
    phone?: string;
    matterParties: Array<{
      role: string;
      matter: { id: string; reference: string; title: string; status: string; updatedAt: string };
    }>;
  }>;
  properties: SearchGroup<{
    id: string;
    displayName: string;
    useType: string;
    addressLine1: string;
    city: string;
    state: string;
    owner?: { id: string; legalName: string };
    matters: Array<{ id: string; reference: string; title: string; status: string; updatedAt: string }>;
    guaranteeFor: Array<{ id: string; reference: string; title: string; status: string; updatedAt: string }>;
  }>;
  documents: SearchGroup<{
    id: string;
    originalName: string;
    type: string;
    version: number;
    mimeType: string;
    createdAt: string;
    matter?: { id: string; reference: string; title: string; status: string };
    person?: { id: string; legalName: string };
    property?: { id: string; displayName: string };
  }>;
}

export interface AuditLogResponse {
  period: { from: string; to: string };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { total: number; systemEvents: number; actorEvents: number; withMatter: number };
  facets: {
    actions: string[];
    entityTypes: string[];
    actors: Array<{ id: string; displayName: string; email: string }>;
  };
  events: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
    createdAt: string;
    actor?: { id: string; displayName: string; email: string };
    matter?: { id: string; reference: string; title: string; status: string };
  }>;
}

export interface SearchGroup<T> {
  items: T[];
  hasMore: boolean;
}

export type DocumentValidityStatus = 'EXPIRED' | 'DUE_15' | 'DUE_30' | 'DUE_90' | 'CURRENT' | 'UNDATED';

export interface LibraryReferenceLink {
  libraryDocument: { id: string; source: string; documentTypeLabel: string; packageLabel: string };
}

export interface DocumentValidityDashboard {
  asOf: string;
  summary: {
    all: number;
    expired: number;
    due15: number;
    due30: number;
    due90: number;
    current: number;
    undated: number;
  };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  documents: Array<{
    id: string;
    type: string;
    originalName: string;
    mimeType: string;
    version: number;
    issuedAt?: string;
    expiresAt?: string;
    createdAt: string;
    validityStatus: DocumentValidityStatus;
    daysRemaining: number | null;
    libraryLinks?: LibraryReferenceLink[];
    matter?: { id: string; reference: string; title: string; status: string };
    person?: { id: string; legalName: string };
    property?: { id: string; displayName: string };
    uploadedBy: { id: string; displayName: string };
  }>;
}

export interface ExtractionSettings {
  enabled: boolean;
  provider: string;
  supportedMimeTypes: string[];
  local?: {
    enabled: boolean;
    provider: string;
    supportedMimeTypes: string[];
  };
}

export interface ExtractionQueueResponse {
  state: 'PENDING_REVIEW' | 'REVIEWED' | 'ALL';
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  runs: Array<{
    id: string;
    provider: string;
    status: 'NOT_REQUESTED' | 'MANUAL_REVIEW' | 'PROCESSING' | 'COMPLETE' | 'FAILED';
    rawData?: Record<string, unknown>;
    fieldCandidates?: Array<{
      field: string;
      value: unknown;
      confidence: number | null;
      source?: string;
    }>;
    message?: string;
    requestedAt: string;
    completedAt?: string;
    requestedBy: { id: string; displayName: string };
    document: {
      id: string;
      type: string;
      originalName: string;
      mimeType: string;
      extractionStatus: string;
      invalidatedAt?: string;
      matter?: { id: string; reference: string; title: string; status: string };
      person?: Person;
      property?: { id: string; displayName: string };
    };
    review?: {
      id: string;
      decision: 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
      confirmedData?: Record<string, unknown>;
      comment: string;
      reviewedAt: string;
      reviewedBy: { id: string; displayName: string };
    };
  }>;
}

export interface PilotReadiness {
  generatedAt: string;
  readyForPilot: boolean;
  summary: {
    blockers: number;
    warnings: number;
    passed: number;
    manualCompleted: number;
    manualTotal: number;
  };
  technicalChecks: Array<{
    code: string;
    label: string;
    status: 'PASS' | 'WARNING' | 'BLOCKED';
    blocking: boolean;
    detail: string;
    value?: number;
  }>;
  checkpoints: Array<{
    id: string;
    code: string;
    label: string;
    description: string;
    blocking: boolean;
    status: 'PENDING' | 'COMPLETE';
    evidence?: string;
    completedAt?: string;
    completedBy?: { id: string; displayName: string; email: string };
  }>;
  operationalGates: PilotOperations['gates'];
}

export interface PilotOperations {
  program: {
    id: string;
    name: string;
    status: 'DRAFT' | 'READY' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
    current: boolean;
    rolloutPercentage: number;
    targetCases: number;
    startsAt?: string;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
  };
  gates: {
    ready: boolean;
    blockers: number;
    checks: Array<{
      code: string;
      label: string;
      status: 'PASS' | 'BLOCKED';
      blocking: true;
      detail: string;
      value: number;
    }>;
    counts: {
      activeParticipants: number;
      untrainedParticipants: number;
      matchedValidations: number;
      pendingValidations: number;
      mismatches: number;
      committedImports: number;
      seriousIssues: number;
    };
  };
  participants: Array<{
    id: string;
    status: 'ACTIVE' | 'REMOVED';
    trainingEvidence?: string;
    trainedAt?: string;
    addedAt: string;
    membership: {
      id: string;
      role: string;
      user: { id: string; displayName: string; email: string; active: boolean };
    };
    trainedBy?: { id: string; displayName: string };
    addedBy: { id: string; displayName: string };
  }>;
  validations: Array<{
    id: string;
    legacyReference?: string;
    result: 'PENDING' | 'MATCH' | 'MISMATCH';
    notes?: string;
    validatedAt?: string;
    createdAt: string;
    matter: { id: string; reference: string; title: string; kind: string; status: string };
    validatedBy?: { id: string; displayName: string };
  }>;
  issues: Array<{
    id: string;
    category: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
    title: string;
    description: string;
    resolution?: string;
    reportedAt: string;
    resolvedAt?: string;
    matter?: { id: string; reference: string; title: string };
    assignedMembership?: { id: string; role: string; user: { id: string; displayName: string } };
    reportedBy: { id: string; displayName: string };
    resolvedBy?: { id: string; displayName: string };
  }>;
  imports: Array<{
    id: string;
    sourceName: string;
    checksum: string;
    status: 'READY' | 'BLOCKED' | 'COMMITTED' | 'CANCELLED';
    totalRows: number;
    validRows: number;
    invalidRows: number;
    importedRows: number;
    validation: Array<{ row: number; legalName: string; valid: boolean; errors: string[] }>;
    createdAt: string;
    committedAt?: string;
    createdBy: { id: string; displayName: string };
    committedBy?: { id: string; displayName: string };
  }>;
  history: Array<{
    id: string;
    name: string;
    status: 'DRAFT' | 'READY' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
    rolloutPercentage: number;
    targetCases: number;
    startsAt?: string;
    completedAt?: string;
    createdAt: string;
  }>;
}

export interface MatterClauseSelection {
  id: string;
  sortOrder: number;
  selectedAt: string;
  clause: Clause;
  clauseVersion: ClauseVersion;
  selectedBy: { id: string; displayName: string };
}

export interface DocumentClauseSnapshot {
  id: string;
  code: string;
  title: string;
  body: string;
  clauseVersionNumber: number;
  sortOrder: number;
}

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface TaskAssignee {
  id: string;
  role: string;
  user: { id: string; displayName: string; email: string; active?: boolean };
}

export interface OperationalTask {
  id: string;
  matterId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  source: 'MANUAL' | 'SYSTEM';
  requiresEvidence: boolean;
  deduplicationKey?: string;
  dueAt?: string;
  completedAt?: string;
  blockedReason?: string;
  blockedAt?: string;
  slaEscalationLevel: number;
  slaEscalatedAt?: string;
  createdAt: string;
  updatedAt: string;
  isOverdue?: boolean;
  isEscalated?: boolean;
  daysRemaining?: number | null;
  daysOverdue?: number;
  matter?: { id: string; reference: string; title: string; status: string };
  assignee?: TaskAssignee;
  createdBy?: { id: string; displayName: string };
  completedBy?: { id: string; displayName: string };
  blockedBy?: { id: string; displayName: string };
  dueDateChanges: Array<{
    id: string;
    previousDueAt?: string;
    newDueAt: string;
    reason: string;
    createdAt: string;
    changedBy: { id: string; displayName: string };
  }>;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; displayName: string };
  }>;
  evidenceLinks: Array<{
    id: string;
    linkedAt: string;
    linkedBy: { id: string; displayName: string };
    document: {
      id: string;
      type: string;
      originalName: string;
      mimeType: string;
      version: number;
      expiresAt?: string;
      invalidatedAt?: string;
      createdAt: string;
    };
  }>;
  prerequisites: Array<{
    id: string;
    createdAt: string;
    createdBy: { id: string; displayName: string };
    dependsOnTask: {
      id: string;
      title: string;
      status: TaskStatus;
      priority: TaskPriority;
      dueAt?: string;
      source: 'MANUAL' | 'SYSTEM';
    };
  }>;
}

export interface TaskDashboard {
  asOf: string;
  metrics: { open: number; overdue: number; blocked: number; dueSoon: number; urgent: number; escalated: number; mine: number };
  workload: Array<{
    membershipId: string | null;
    displayName: string;
    role?: string;
    open: number;
    overdue: number;
    blocked: number;
    urgent: number;
    escalated: number;
  }>;
  priorityItems: OperationalTask[];
}

export interface OperationsReport {
  generatedAt: string;
  period: { from: string; to: string; asOf: string };
  summary: {
    mattersCreated: number;
    leasesCreated: number;
    agreementsCreated: number;
    documentsAdded: number;
    draftsGenerated: number;
    finalApprovals: number;
    signaturesCompleted: number;
    mattersActivated: number;
    mattersClosed: number;
    portalSubmissionsAccepted: number;
  };
  cycleTimes: {
    averageDaysToActivation: number | null;
    averageDaysDraftToApproval: number | null;
  };
  taskSla: {
    created: number;
    completed: number;
    withDueDate: number;
    completedOnTime: number;
    compliancePercent: number | null;
    averageDaysToComplete: number | null;
    open: number;
    overdue: number;
    blocked: number;
    blockedOver48Hours: number;
  };
  pipeline: Array<{ status: string; count: number }>;
  workload: Array<{
    membershipId: string | null;
    displayName: string;
    role?: string;
    open: number;
    overdue: number;
    blocked: number;
    urgent: number;
  }>;
  renewalRisk: {
    total: number;
    expired: number;
    due15: number;
    due30: number;
    due60: number;
    due90: number;
    items: Array<{
      matterId: string;
      reference: string;
      title: string;
      status: string;
      propertyName?: string;
      responsibleName?: string;
      endDate: string;
      daysRemaining: number;
      level: RenewalAlert['level'];
      thresholdDays: number | null;
    }>;
  };
  bottlenecks: {
    staleAfterDays: number;
    blockedTasks: Array<{
      taskId: string;
      title: string;
      matterId: string;
      reference: string;
      matterTitle: string;
      responsibleName?: string;
      reason: string;
      blockedAt: string;
      daysBlocked: number;
    }>;
    staleMatters: Array<{
      matterId: string;
      reference: string;
      title: string;
      status: string;
      updatedAt: string;
      daysWithoutActivity: number;
      propertyName?: string;
      responsibleName?: string;
      blockingChecklistItems: number;
      blockedTasks: number;
    }>;
  };
}

export interface MatterDetail extends MatterSummary {
  notes?: string;
  activatedAt?: string;
  propertyId?: string;
  guaranteePropertyId?: string;
  linkedMatterId?: string;
  guaranteeProperty?: Property;
  linkedMatter?: Pick<MatterSummary, 'id' | 'reference' | 'title' | 'kind' | 'status'> & { propertyId?: string };
  parties: Array<{ id: string; role: string; person: Person }>;
  leaseTerms?: Record<string, string | number | boolean>;
  mediationTerms?: Record<string, string | number>;
  checklistItems: Array<{
    id: string;
    code: string;
    label: string;
    blocking: boolean;
    appliesToRole?: string;
    completionMode: 'AUTO' | 'MANUAL';
    sortOrder: number;
    status: 'PENDING' | 'COMPLETE' | 'WAIVED';
    waivedReason?: string;
  }>; 
  clauseSelections: MatterClauseSelection[];
  readiness: {
    level: 'BLOCKED' | 'ATTENTION' | 'READY';
    label: string;
    summary: string;
    canAdvance: boolean;
    reasons: Array<{
      code: 'BLOCKING_REQUIREMENTS' | 'HIGH_WARNINGS' | 'MEDIUM_WARNINGS' | 'RECOMMENDED_REQUIREMENTS';
      count: number;
      label: string;
      source: 'CHECKLIST' | 'CONSISTENCY';
    }>;
  };
  consistency: {
    evaluatedAt: string;
    total: number;
    high: number;
    medium: number;
    low: number;
    warnings: Array<{
      code: string;
      severity: 'HIGH' | 'MEDIUM' | 'LOW';
      category: 'DOCUMENT' | 'PARTY' | 'TERMS' | 'RELATION';
      title: string;
      detail: string;
      recommendation: string;
      entityType?: 'Document' | 'Person' | 'Property' | 'Matter' | 'LeaseTerms';
      entityId?: string;
    }>;
  };
  documents: Array<{
    id: string;
    type: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    checksum?: string;
    personId?: string;
    propertyId?: string;
    issuedAt?: string;
    expiresAt?: string;
    invalidatedAt?: string;
    invalidationReason?: string;
    invalidatedBy?: { id: string; displayName: string };
    isCurrentVersion: boolean;
    sourceDocumentId?: string;
    extractionStatus: string;
    version: number;
    createdAt: string;
    libraryLinks?: LibraryReferenceLink[];
    sourceDocument?: {
      id: string;
      originalName: string;
      type: string;
      version: number;
      checksum?: string;
    };
    derivedDocuments: Array<{
      id: string;
      originalName: string;
      type: string;
      version: number;
      checksum?: string;
    }>;
    clauseSnapshots: DocumentClauseSnapshot[];
    reviews: Array<{
      id: string;
      decision: 'CHANGES_REQUESTED' | 'LEGAL_APPROVED' | 'FINAL_APPROVED';
      comment: string;
      createdAt: string;
      reviewer: { id: string; displayName: string };
    }>;
  }>;
  signatureRequests: Array<{
    id: string;
    provider: string;
    externalReference?: string;
    status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
    notes?: string;
    requestedAt: string;
    completedAt?: string;
    cancelledAt?: string;
    signedAt?: string;
    sourceDocument: { id: string; originalName: string; version: number };
    signedDocument?: { id: string; originalName: string; version: number };
    requestedBy: { id: string; displayName: string };
    completedBy?: { id: string; displayName: string };
    cancelledBy?: { id: string; displayName: string };
  }>;
  terminationProcesses: Array<{
    id: string;
    status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
    previousMatterStatus: string;
    reason: string;
    effectiveDate?: string;
    startedAt: string;
    cancelledAt?: string;
    cancellationReason?: string;
    closedAt?: string;
    closureReason?: string;
    evidenceDocument?: { id: string; originalName: string; version: number };
    startedBy: { id: string; displayName: string };
    cancelledBy?: { id: string; displayName: string };
    closedBy?: { id: string; displayName: string };
  }>;
  tasks: OperationalTask[];
  auditEvents: Array<{
    id: string;
    action: string;
    createdAt: string;
    payload?: Record<string, unknown>;
    actor?: { id: string; displayName: string };
  }>;
}

export interface DocumentComparison {
  currentDocument: { id: string; originalName: string; version: number };
  previousDocument: { id: string; originalName: string; version: number };
  changes: Array<{ paragraph: number; before: string; after: string }>;
}

export interface PortalUpload {
  id: string;
  type: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksum?: string;
  createdAt: string;
  acceptedDocumentId?: string;
}

export interface PortalInvitation {
  id: string;
  invitedEmail?: string;
  partyRole: string;
  expiresAt: string;
  revokedAt?: string;
  lastAccessedAt?: string;
  createdAt: string;
  effectiveStatus: 'DRAFT' | 'PENDING_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'REVOKED' | 'EXPIRED';
  invitedPerson?: { id: string; legalName: string };
  createdBy: { id: string; displayName: string };
  submission?: {
    id: string;
    status: 'DRAFT' | 'PENDING_REVIEW' | 'ACCEPTED' | 'REJECTED';
    personData?: Record<string, string>;
    submittedAt?: string;
    reviewedAt?: string;
    reviewComment?: string;
    acceptedPerson?: { id: string; legalName: string };
    reviewedBy?: { id: string; displayName: string };
    uploads: PortalUpload[];
  };
}

export interface PublicPortalIntake {
  organizationName: string;
  matter: { reference: string; title: string; kind: 'LEASE' | 'MEDIATION_AGREEMENT' };
  invitation: {
    partyRole: string;
    expiresAt: string;
    invitedEmail?: string;
    invitedPersonName?: string;
  };
  submission: {
    status: 'DRAFT' | 'PENDING_REVIEW' | 'ACCEPTED' | 'REJECTED';
    personData?: Record<string, string>;
    submittedAt?: string;
    reviewComment?: string;
    uploads: PortalUpload[];
  };
  allowedDocumentTypes: string[];
  expectedIdentityType?: string;
}

export const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  INTEGRATION: 'En integración',
  PENDING_CLIENT: 'Pendiente del cliente',
  VALIDATION: 'En validación',
  READY_TO_DRAFT: 'Listo para elaborar',
  DRAFTING: 'En elaboración',
  REVIEW: 'En revisión',
  APPROVAL: 'En aprobación',
  SIGNATURE: 'En firma',
  ACTIVE: 'Activo',
  RENEWAL_DUE: 'Por renovar',
  TERMINATION: 'En terminación',
  CLOSED: 'Cerrado',
  CANCELLED: 'Cancelado',
};
