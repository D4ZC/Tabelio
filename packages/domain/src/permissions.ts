export type MembershipRole = 'ADMIN' | 'LAWYER' | 'OPERATOR' | 'VIEWER';

export const PERMISSIONS = [
  'DIRECTORY_READ',
  'DIRECTORY_WRITE',
  'MATTER_READ',
  'MATTER_WRITE',
  'MATTER_TRANSITION',
  'CHECKLIST_WAIVE',
  'DOCUMENT_READ',
  'DOCUMENT_WRITE',
  'CONTRACT_GENERATE',
  'CONTRACT_REVIEW',
  'CONTRACT_APPROVE',
  'SIGNATURE_MANAGE',
  'RENEWAL_MANAGE',
  'LIFECYCLE_MANAGE',
  'NOTIFICATION_MANAGE',
  'CLAUSE_READ',
  'CLAUSE_MANAGE',
  'CLAUSE_APPROVE',
  'CLAUSE_SELECT',
  'TASK_READ',
  'TASK_MANAGE',
  'REPORT_READ',
  'REPORT_EXPORT',
  'REQUIREMENT_READ',
  'REQUIREMENT_MANAGE',
  'AUDIT_READ',
  'AUDIT_EXPORT',
  'PILOT_READ',
  'PILOT_MANAGE',
  'LAUNCH_READ',
  'LAUNCH_MANAGE',
  'MEMBER_READ',
  'MEMBER_MANAGE',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const rolePermissions: Record<MembershipRole, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  LAWYER: PERMISSIONS.filter(
    (permission) => ![
      'MEMBER_MANAGE',
      'CONTRACT_APPROVE',
      'CLAUSE_APPROVE',
      'REQUIREMENT_MANAGE',
      'AUDIT_READ',
      'AUDIT_EXPORT',
      'PILOT_READ',
      'PILOT_MANAGE',
      'LAUNCH_READ',
      'LAUNCH_MANAGE',
    ].includes(permission),
  ),
  OPERATOR: [
    'DIRECTORY_READ',
    'DIRECTORY_WRITE',
    'MATTER_READ',
    'MATTER_WRITE',
    'DOCUMENT_READ',
    'DOCUMENT_WRITE',
    'TASK_READ',
    'TASK_MANAGE',
    'REPORT_READ',
  ],
  VIEWER: ['DIRECTORY_READ', 'MATTER_READ', 'DOCUMENT_READ', 'TASK_READ', 'REPORT_READ'],
};

export function hasPermission(role: MembershipRole, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}

export function assertPermission(role: MembershipRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`El rol ${role} no tiene el permiso ${permission}`);
  }
}
