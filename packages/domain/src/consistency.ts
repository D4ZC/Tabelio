import { currentDocuments } from './document-versions';

export type ConsistencySeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type ConsistencyCategory = 'DOCUMENT' | 'PARTY' | 'TERMS' | 'RELATION';

export interface ConsistencyWarning {
  code: string;
  severity: ConsistencySeverity;
  category: ConsistencyCategory;
  title: string;
  detail: string;
  recommendation: string;
  entityType?: 'Document' | 'Person' | 'Property' | 'Matter' | 'LeaseTerms';
  entityId?: string;
}

export interface ConsistencySnapshot {
  kind: 'LEASE' | 'MEDIATION_AGREEMENT';
  propertyId?: string | null;
  guaranteePropertyId?: string | null;
  linkedMatterId?: string | null;
  linkedPropertyId?: string | null;
  parties: Array<{ role: string; personId: string }>;
  documents: Array<{
    id: string;
    type: string;
    originalName: string;
    version: number;
    personId?: string | null;
    propertyId?: string | null;
    expiresAt?: Date | string | null;
  }>;
  leaseTerms?: {
    startDate: Date | string;
    endDate: Date | string;
    durationMonths: number;
    depositAmount?: unknown;
    prepaidRentAmount?: unknown;
    totalInitialPayment?: unknown;
  } | null;
}

export interface ConsistencyReport {
  total: number;
  high: number;
  medium: number;
  low: number;
  warnings: ConsistencyWarning[];
}

const IDENTITY_ROLE: Record<string, string> = {
  LANDLORD_ID: 'LANDLORD',
  TENANT_ID: 'TENANT',
  GUARANTOR_ID: 'GUARANTOR',
};

const CANONICAL_ROLE: Record<string, string> = {
  REQUESTING_PARTY: 'LANDLORD',
  COMPLEMENTARY_PARTY: 'TENANT',
};

const ROLE_LABEL: Record<string, string> = {
  LANDLORD: 'arrendador o parte solicitante',
  TENANT: 'arrendatario o parte complementaria',
  GUARANTOR: 'obligado solidario',
};

const PERSON_VALIDITY_TYPES = new Set([
  'LANDLORD_ID',
  'TENANT_ID',
  'GUARANTOR_ID',
  'TAX_ID',
  'PROOF_OF_ADDRESS',
]);

const SEVERITY_ORDER: Record<ConsistencySeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function validateMatterConsistency(
  snapshot: ConsistencySnapshot,
  asOf = new Date(),
): ConsistencyReport {
  const warnings: ConsistencyWarning[] = [];
  const partiesByRole = new Map<string, string>();
  for (const party of snapshot.parties) {
    partiesByRole.set(party.role, party.personId);
    const canonicalRole = CANONICAL_ROLE[party.role];
    if (canonicalRole && !partiesByRole.has(canonicalRole)) {
      partiesByRole.set(canonicalRole, party.personId);
    }
  }
  const partyPersonIds = new Set(snapshot.parties.map((party) => party.personId));
  const rolesByPerson = new Map<string, string[]>();
  for (const party of snapshot.parties) {
    const canonicalRole = CANONICAL_ROLE[party.role] ?? party.role;
    const roles = rolesByPerson.get(party.personId) ?? [];
    if (!roles.includes(canonicalRole)) roles.push(canonicalRole);
    rolesByPerson.set(party.personId, roles);
  }
  for (const [personId, roles] of rolesByPerson) {
    if (roles.length < 2) continue;
    warnings.push({
      code: 'PARTY_ROLE_CONFLICT', severity: 'HIGH', category: 'PARTY',
      title: 'Una persona ocupa varios roles',
      detail: `La misma persona está registrada como ${roles.map((role) => ROLE_LABEL[role] ?? role).join(' y ')}.`,
      recommendation: 'Confirma los participantes y conserva un rol jurídico distinto por persona.',
      entityType: 'Person', entityId: personId,
    });
  }

  const asOfDay = utcDay(asOf);
  for (const document of currentDocuments(snapshot.documents)) {
    const expectedRole = IDENTITY_ROLE[document.type];
    const expectedPersonId = expectedRole ? partiesByRole.get(expectedRole) : undefined;
    if (expectedPersonId && !document.personId) {
      warnings.push({
        code: 'DOCUMENT_PERSON_MISSING', severity: 'MEDIUM', category: 'DOCUMENT',
        title: 'Documento sin persona relacionada',
        detail: `${document.originalName} debe vincularse con la parte ${expectedRole}.`,
        recommendation: 'Asigna la persona correcta en la clasificación documental.',
        entityType: 'Document', entityId: document.id,
      });
    } else if (expectedPersonId && document.personId !== expectedPersonId) {
      warnings.push({
        code: 'DOCUMENT_PERSON_MISMATCH', severity: 'HIGH', category: 'DOCUMENT',
        title: 'Identificación vinculada a otra persona',
        detail: `${document.originalName} no corresponde con la persona registrada para ${expectedRole}.`,
        recommendation: 'Corrige la asociación antes de elaborar el documento jurídico.',
        entityType: 'Document', entityId: document.id,
      });
    } else if (!expectedRole && document.personId && !partyPersonIds.has(document.personId)) {
      warnings.push({
        code: 'DOCUMENT_PERSON_OUTSIDE_MATTER', severity: 'MEDIUM', category: 'DOCUMENT',
        title: 'Documento asociado a una persona ajena al expediente',
        detail: `${document.originalName} está vinculado a una persona que no participa en este asunto.`,
        recommendation: 'Confirma la persona o incorpórala formalmente como parte del expediente.',
        entityType: 'Document', entityId: document.id,
      });
    }

    const expectedPropertyId = document.type === 'PROPERTY_TITLE'
      ? snapshot.propertyId
      : document.type === 'GUARANTEE_PROPERTY_TITLE' ? snapshot.guaranteePropertyId : undefined;
    if (expectedPropertyId && !document.propertyId) {
      warnings.push({
        code: 'DOCUMENT_PROPERTY_MISSING', severity: 'MEDIUM', category: 'DOCUMENT',
        title: 'Documento sin inmueble relacionado',
        detail: `${document.originalName} no identifica el inmueble que acredita.`,
        recommendation: 'Asigna el inmueble principal o el ofrecido en garantía.',
        entityType: 'Document', entityId: document.id,
      });
    } else if (expectedPropertyId && document.propertyId !== expectedPropertyId) {
      warnings.push({
        code: 'DOCUMENT_PROPERTY_MISMATCH', severity: 'HIGH', category: 'DOCUMENT',
        title: 'Acreditación vinculada a otro inmueble',
        detail: `${document.originalName} no corresponde con el inmueble seleccionado en el expediente.`,
        recommendation: 'Corrige la asociación o confirma cuál inmueble debe permanecer en el asunto.',
        entityType: 'Document', entityId: document.id,
      });
    }

    if (document.expiresAt) {
      const daysRemaining = Math.round((utcDay(document.expiresAt) - asOfDay) / 86_400_000);
      if (daysRemaining < 0) {
        warnings.push({
          code: 'DOCUMENT_EXPIRED', severity: 'HIGH', category: 'DOCUMENT',
          title: 'La evidencia documental está vencida',
          detail: `${document.originalName} venció hace ${Math.abs(daysRemaining)} día(s).`,
          recommendation: 'Solicita una evidencia vigente o corrige su fecha si fue capturada incorrectamente.',
          entityType: 'Document', entityId: document.id,
        });
      } else if (daysRemaining <= 30) {
        warnings.push({
          code: 'DOCUMENT_EXPIRING_SOON', severity: 'MEDIUM', category: 'DOCUMENT',
          title: 'Documento próximo a vencer',
          detail: `${document.originalName} vence en ${daysRemaining} día(s).`,
          recommendation: 'Prevé su renovación antes de que deje de completar el checklist.',
          entityType: 'Document', entityId: document.id,
        });
      }
    } else if (PERSON_VALIDITY_TYPES.has(document.type)) {
      warnings.push({
        code: 'DOCUMENT_VALIDITY_UNRECORDED', severity: 'LOW', category: 'DOCUMENT',
        title: 'Vigencia documental no registrada',
        detail: `${document.originalName} no tiene fecha de vencimiento.`,
        recommendation: 'Captura la vigencia cuando el documento la indique.',
        entityType: 'Document', entityId: document.id,
      });
    }
  }

  if (snapshot.leaseTerms) validateLeaseTerms(snapshot.leaseTerms, warnings);
  if (
    snapshot.kind === 'MEDIATION_AGREEMENT'
    && snapshot.propertyId
    && snapshot.linkedPropertyId
    && snapshot.propertyId !== snapshot.linkedPropertyId
  ) {
    warnings.push({
      code: 'LINKED_PROPERTY_MISMATCH', severity: 'HIGH', category: 'RELATION',
      title: 'El convenio apunta a otro inmueble',
      detail: 'El inmueble del convenio no coincide con el arrendamiento vinculado.',
      recommendation: 'Relaciona el inmueble del contrato origen antes de generar el convenio.',
      entityType: 'Matter', entityId: snapshot.linkedMatterId ?? undefined,
    });
  }

  warnings.sort((left, right) => (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.category.localeCompare(right.category)
    || left.code.localeCompare(right.code)
  ));
  return {
    total: warnings.length,
    high: warnings.filter((warning) => warning.severity === 'HIGH').length,
    medium: warnings.filter((warning) => warning.severity === 'MEDIUM').length,
    low: warnings.filter((warning) => warning.severity === 'LOW').length,
    warnings,
  };
}

function validateLeaseTerms(
  terms: NonNullable<ConsistencySnapshot['leaseTerms']>,
  warnings: ConsistencyWarning[],
) {
  const start = new Date(terms.startDate);
  const end = new Date(terms.endDate);
  if (end <= start) {
    warnings.push({
      code: 'LEASE_DATE_RANGE', severity: 'HIGH', category: 'TERMS',
      title: 'La vigencia contractual es inválida',
      detail: 'La fecha final no es posterior a la fecha inicial.',
      recommendation: 'Corrige las fechas antes de elaborar el contrato.',
      entityType: 'LeaseTerms',
    });
  } else {
    const expectedEnd = new Date(Date.UTC(
      start.getUTCFullYear(), start.getUTCMonth() + terms.durationMonths, start.getUTCDate(),
    ));
    expectedEnd.setUTCDate(expectedEnd.getUTCDate() - 1);
    if (utcDay(expectedEnd) !== utcDay(end)) {
      warnings.push({
        code: 'LEASE_DURATION_MISMATCH', severity: 'MEDIUM', category: 'TERMS',
        title: 'Duración y fechas no coinciden',
        detail: `La vigencia capturada no corresponde exactamente con ${terms.durationMonths} mes(es).`,
        recommendation: 'Confirma la duración o ajusta la fecha final del arrendamiento.',
        entityType: 'LeaseTerms',
      });
    }
  }

  const deposit = numeric(terms.depositAmount);
  const prepaid = numeric(terms.prepaidRentAmount);
  const total = numeric(terms.totalInitialPayment);
  if (deposit !== undefined && prepaid !== undefined && total !== undefined
    && Math.abs(deposit + prepaid - total) > 0.01) {
    warnings.push({
      code: 'INITIAL_PAYMENT_MISMATCH', severity: 'HIGH', category: 'TERMS',
      title: 'El pago inicial no cuadra',
      detail: 'El total inicial no coincide con la suma del depósito y la renta anticipada.',
      recommendation: 'Corrige los importes antes de generar el contrato.',
      entityType: 'LeaseTerms',
    });
  }
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function utcDay(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
