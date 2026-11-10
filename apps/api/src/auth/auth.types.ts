import type { MembershipRole } from '@despacho/database';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  membershipId: string;
  role: MembershipRole;
}

export interface JwtPayload {
  sub: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  membershipId: string;
  role: MembershipRole;
  sessionVersion: number;
}
