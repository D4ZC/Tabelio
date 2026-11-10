export type MatterKind = 'LEASE' | 'MEDIATION_AGREEMENT';

export interface ChecklistDefinition {
  code: string;
  label: string;
  blocking: boolean;
  appliesToRole?: 'LANDLORD' | 'TENANT' | 'GUARANTOR';
}

const leaseChecklist: ChecklistDefinition[] = [
  { code: 'PROPERTY', label: 'Inmueble capturado', blocking: true },
  { code: 'PARTY_LANDLORD', label: 'Arrendador/a capturado/a', blocking: true, appliesToRole: 'LANDLORD' },
  { code: 'PARTY_TENANT', label: 'Arrendatario/a capturado/a', blocking: true, appliesToRole: 'TENANT' },
  { code: 'PARTY_GUARANTOR', label: 'Obligado solidario capturado', blocking: true, appliesToRole: 'GUARANTOR' },
  { code: 'LEASE_TERMS', label: 'Renta, depósito, vigencia y forma de pago', blocking: true },
  { code: 'DOC_LANDLORD_ID', label: 'Identificación del arrendador', blocking: true, appliesToRole: 'LANDLORD' },
  { code: 'DOC_TENANT_ID', label: 'Identificación del arrendatario', blocking: true, appliesToRole: 'TENANT' },
  { code: 'DOC_GUARANTOR_ID', label: 'Identificación del obligado solidario', blocking: true, appliesToRole: 'GUARANTOR' },
  { code: 'DOC_PROPERTY_TITLE', label: 'Documento que acredita propiedad', blocking: true },
  { code: 'GUARANTEE_PROPERTY', label: 'Inmueble y documento ofrecidos en garantía', blocking: false, appliesToRole: 'GUARANTOR' },
];

const mediationChecklist: ChecklistDefinition[] = [
  { code: 'LINKED_LEASE', label: 'Contrato de arrendamiento relacionado', blocking: true },
  { code: 'MEDIATION_DATA', label: 'Número, expediente, fecha y facilitador', blocking: true },
  ...leaseChecklist.filter((item) => item.code !== 'LEASE_TERMS'),
  { code: 'DOC_LEASE_ANNEX', label: 'Contrato agregado como Anexo 1', blocking: true },
];

export function checklistFor(kind: MatterKind): ChecklistDefinition[] {
  return (kind === 'LEASE' ? leaseChecklist : mediationChecklist).map((item) => ({ ...item }));
}

export interface ChecklistSnapshot {
  hasProperty: boolean;
  partyRoles: string[];
  hasLeaseTerms: boolean;
  hasLinkedLease: boolean;
  hasMediationData: boolean;
  documentTypes: string[];
  hasGuaranteeProperty: boolean;
}

export function isChecklistItemComplete(code: string, snapshot: ChecklistSnapshot): boolean {
  const checks: Record<string, boolean> = {
    PROPERTY: snapshot.hasProperty,
    PARTY_LANDLORD: snapshot.partyRoles.includes('LANDLORD'),
    PARTY_TENANT: snapshot.partyRoles.includes('TENANT'),
    PARTY_GUARANTOR: snapshot.partyRoles.includes('GUARANTOR'),
    LEASE_TERMS: snapshot.hasLeaseTerms,
    LINKED_LEASE: snapshot.hasLinkedLease,
    MEDIATION_DATA: snapshot.hasMediationData,
    DOC_LANDLORD_ID: snapshot.documentTypes.includes('LANDLORD_ID'),
    DOC_TENANT_ID: snapshot.documentTypes.includes('TENANT_ID'),
    DOC_GUARANTOR_ID: snapshot.documentTypes.includes('GUARANTOR_ID'),
    DOC_PROPERTY_TITLE: snapshot.documentTypes.includes('PROPERTY_TITLE'),
    DOC_LEASE_ANNEX: snapshot.documentTypes.includes('LEASE_ANNEX'),
    GUARANTEE_PROPERTY: snapshot.hasGuaranteeProperty,
  };
  return checks[code] ?? false;
}

