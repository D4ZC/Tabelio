import { describe, expect, it } from 'vitest';
import { validateMatterConsistency, type ConsistencySnapshot } from './consistency';

const asOf = new Date('2026-10-09T18:00:00.000Z');

function snapshot(overrides: Partial<ConsistencySnapshot> = {}): ConsistencySnapshot {
  return {
    kind: 'LEASE',
    propertyId: 'property-main',
    guaranteePropertyId: 'property-guarantee',
    parties: [
      { role: 'LANDLORD', personId: 'person-landlord' },
      { role: 'TENANT', personId: 'person-tenant' },
      { role: 'GUARANTOR', personId: 'person-guarantor' },
    ],
    documents: [],
    leaseTerms: {
      startDate: '2026-11-01', endDate: '2027-10-31', durationMonths: 12,
      depositAmount: 15000, prepaidRentAmount: 15000, totalInitialPayment: 30000,
    },
    ...overrides,
  };
}

describe('advertencias de consistencia', () => {
  it('no genera falsos positivos cuando asociaciones, fechas e importes coinciden', () => {
    const result = validateMatterConsistency(snapshot({
      documents: [
        { id: 'doc-id', type: 'LANDLORD_ID', originalName: 'ine.pdf', version: 1, personId: 'person-landlord', expiresAt: '2030-01-01' },
        { id: 'doc-title', type: 'PROPERTY_TITLE', originalName: 'escritura.pdf', version: 1, propertyId: 'property-main' },
      ],
    }), asOf);
    expect(result).toMatchObject({ total: 0, high: 0, medium: 0, low: 0 });
  });

  it('detecta asociaciones equivocadas y vigencia expirada sin bloquear', () => {
    const result = validateMatterConsistency(snapshot({
      documents: [{
        id: 'doc-id', type: 'LANDLORD_ID', originalName: 'ine.pdf', version: 2,
        personId: 'person-tenant', expiresAt: '2026-09-30',
      }],
    }), asOf);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'DOCUMENT_EXPIRED',
      'DOCUMENT_PERSON_MISMATCH',
    ]);
    expect(result.high).toBe(2);
  });

  it('revisa roles, duración, pago inicial y relación del convenio', () => {
    const result = validateMatterConsistency(snapshot({
      kind: 'MEDIATION_AGREEMENT',
      linkedMatterId: 'lease-1',
      linkedPropertyId: 'other-property',
      parties: [
        { role: 'LANDLORD', personId: 'same-person' },
        { role: 'TENANT', personId: 'same-person' },
      ],
      leaseTerms: {
        startDate: '2026-11-01', endDate: '2027-11-15', durationMonths: 12,
        depositAmount: 10000, prepaidRentAmount: 5000, totalInitialPayment: 12000,
      },
    }), asOf);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'PARTY_ROLE_CONFLICT',
      'LINKED_PROPERTY_MISMATCH',
      'INITIAL_PAYMENT_MISMATCH',
      'LEASE_DURATION_MISMATCH',
    ]);
    expect(result).toMatchObject({ high: 3, medium: 1 });
  });

  it('sólo evalúa la versión documental más reciente por tipo', () => {
    const result = validateMatterConsistency(snapshot({
      documents: [
        { id: 'old', type: 'TENANT_ID', originalName: 'anterior.pdf', version: 1, personId: 'person-tenant', expiresAt: '2025-01-01' },
        { id: 'current', type: 'TENANT_ID', originalName: 'vigente.pdf', version: 2, personId: 'person-tenant', expiresAt: '2030-01-01' },
      ],
    }), asOf);
    expect(result.total).toBe(0);
  });

  it('reconoce los roles equivalentes del convenio sin advertencias falsas', () => {
    const result = validateMatterConsistency(snapshot({
      kind: 'MEDIATION_AGREEMENT',
      parties: [
        { role: 'LANDLORD', personId: 'person-landlord' },
        { role: 'REQUESTING_PARTY', personId: 'person-landlord' },
        { role: 'TENANT', personId: 'person-tenant' },
        { role: 'COMPLEMENTARY_PARTY', personId: 'person-tenant' },
      ],
    }), asOf);
    expect(result.warnings.some((warning) => warning.code === 'PARTY_ROLE_CONFLICT')).toBe(false);
  });
});
