import { describe, expect, it } from 'vitest';
import { checklistFor, isChecklistItemComplete } from './checklist';
import { hasPermission } from './permissions';
import { renewalAlertFor } from './renewal';
import { assertSameOrganization, organizationScope } from './tenancy';
import { assertTransition, canTransition } from './workflow';

describe('aislamiento por organización', () => {
  it('impone la organización activa sobre filtros recibidos', () => {
    expect(organizationScope('org-a', { organizationId: 'org-b', id: 'x' })).toEqual({
      organizationId: 'org-a',
      id: 'x',
    });
  });

  it('rechaza una entidad de otra organización', () => {
    expect(() => assertSameOrganization('org-a', 'org-b')).toThrow(/organización activa/);
  });
});

describe('workflow', () => {
  it('permite el avance esperado y bloquea saltos', () => {
    expect(canTransition('DRAFT', 'INTEGRATION')).toBe(true);
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(() => assertTransition('CLOSED', 'ACTIVE')).toThrow(/no permitida/);
  });
});

describe('checklist de plantillas', () => {
  it('incluye requisitos adicionales para convenio', () => {
    const codes = checklistFor('MEDIATION_AGREEMENT').map(({ code }) => code);
    expect(codes).toContain('LINKED_LEASE');
    expect(codes).toContain('DOC_LEASE_ANNEX');
  });

  it('evalúa evidencia real y no marca faltantes como completos', () => {
    const snapshot = {
      hasProperty: true,
      partyRoles: ['LANDLORD', 'TENANT'],
      hasLeaseTerms: true,
      hasLinkedLease: false,
      hasMediationData: false,
      documentTypes: ['LANDLORD_ID'],
      hasGuaranteeProperty: false,
    };
    expect(isChecklistItemComplete('PROPERTY', snapshot)).toBe(true);
    expect(isChecklistItemComplete('DOC_TENANT_ID', snapshot)).toBe(false);
  });
});

describe('permisos', () => {
  it('reserva las dispensas para perfiles jurídicos', () => {
    expect(hasPermission('ADMIN', 'CHECKLIST_WAIVE')).toBe(true);
    expect(hasPermission('LAWYER', 'CHECKLIST_WAIVE')).toBe(true);
    expect(hasPermission('OPERATOR', 'CHECKLIST_WAIVE')).toBe(false);
    expect(hasPermission('VIEWER', 'MATTER_WRITE')).toBe(false);
    expect(hasPermission('ADMIN', 'MEMBER_MANAGE')).toBe(true);
    expect(hasPermission('LAWYER', 'MEMBER_MANAGE')).toBe(false);
    expect(hasPermission('LAWYER', 'CONTRACT_GENERATE')).toBe(true);
    expect(hasPermission('OPERATOR', 'CONTRACT_GENERATE')).toBe(false);
    expect(hasPermission('LAWYER', 'CONTRACT_REVIEW')).toBe(true);
    expect(hasPermission('LAWYER', 'CONTRACT_APPROVE')).toBe(false);
    expect(hasPermission('ADMIN', 'CONTRACT_APPROVE')).toBe(true);
    expect(hasPermission('LAWYER', 'SIGNATURE_MANAGE')).toBe(true);
    expect(hasPermission('OPERATOR', 'SIGNATURE_MANAGE')).toBe(false);
    expect(hasPermission('LAWYER', 'RENEWAL_MANAGE')).toBe(true);
    expect(hasPermission('OPERATOR', 'RENEWAL_MANAGE')).toBe(false);
    expect(hasPermission('LAWYER', 'LIFECYCLE_MANAGE')).toBe(true);
    expect(hasPermission('OPERATOR', 'LIFECYCLE_MANAGE')).toBe(false);
    expect(hasPermission('LAWYER', 'NOTIFICATION_MANAGE')).toBe(true);
    expect(hasPermission('OPERATOR', 'NOTIFICATION_MANAGE')).toBe(false);
    expect(hasPermission('LAWYER', 'CLAUSE_MANAGE')).toBe(true);
    expect(hasPermission('LAWYER', 'CLAUSE_APPROVE')).toBe(false);
    expect(hasPermission('ADMIN', 'CLAUSE_APPROVE')).toBe(true);
    expect(hasPermission('OPERATOR', 'CLAUSE_SELECT')).toBe(false);
    expect(hasPermission('LAWYER', 'TASK_MANAGE')).toBe(true);
    expect(hasPermission('OPERATOR', 'TASK_MANAGE')).toBe(true);
    expect(hasPermission('VIEWER', 'TASK_READ')).toBe(true);
    expect(hasPermission('VIEWER', 'TASK_MANAGE')).toBe(false);
    expect(hasPermission('ADMIN', 'REPORT_EXPORT')).toBe(true);
    expect(hasPermission('LAWYER', 'REPORT_EXPORT')).toBe(true);
    expect(hasPermission('OPERATOR', 'REPORT_READ')).toBe(true);
    expect(hasPermission('OPERATOR', 'REPORT_EXPORT')).toBe(false);
    expect(hasPermission('VIEWER', 'REPORT_READ')).toBe(true);
    expect(hasPermission('ADMIN', 'REQUIREMENT_MANAGE')).toBe(true);
    expect(hasPermission('LAWYER', 'REQUIREMENT_READ')).toBe(true);
    expect(hasPermission('LAWYER', 'REQUIREMENT_MANAGE')).toBe(false);
    expect(hasPermission('OPERATOR', 'REQUIREMENT_READ')).toBe(false);
    expect(hasPermission('ADMIN', 'AUDIT_READ')).toBe(true);
    expect(hasPermission('ADMIN', 'AUDIT_EXPORT')).toBe(true);
    expect(hasPermission('LAWYER', 'AUDIT_READ')).toBe(false);
    expect(hasPermission('ADMIN', 'PILOT_MANAGE')).toBe(true);
    expect(hasPermission('LAWYER', 'PILOT_READ')).toBe(false);
    expect(hasPermission('LAWYER', 'PILOT_MANAGE')).toBe(false);
    expect(hasPermission('OPERATOR', 'PILOT_READ')).toBe(false);
  });

  it.each(['PILOT_READ', 'PILOT_MANAGE', 'LAUNCH_READ', 'LAUNCH_MANAGE'] as const)(
    'reserva %s para administración de la puesta en marcha',
    (permission) => {
      expect(hasPermission('ADMIN', permission)).toBe(true);
      for (const role of ['LAWYER', 'OPERATOR', 'VIEWER'] as const) {
        expect(hasPermission(role, permission), `${role}: ${permission}`).toBe(false);
      }
    },
  );
});

describe('alertas de renovación', () => {
  const asOf = new Date('2026-10-09T20:00:00.000Z');

  it.each([
    [91, 'NONE', null],
    [90, 'DUE_90', 90],
    [60, 'DUE_60', 60],
    [30, 'DUE_30', 30],
    [15, 'DUE_15', 15],
    [0, 'DUE_15', 15],
    [-1, 'EXPIRED', 0],
  ])('clasifica %i días restantes como %s', (days, level, thresholdDays) => {
    const endDate = new Date(asOf);
    endDate.setUTCDate(endDate.getUTCDate() + Number(days));
    expect(renewalAlertFor(endDate, asOf)).toMatchObject({ level, thresholdDays, daysRemaining: days });
  });
});
