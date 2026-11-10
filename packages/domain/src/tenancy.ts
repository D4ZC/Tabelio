export function assertSameOrganization(
  activeOrganizationId: string,
  entityOrganizationId: string,
): void {
  if (!activeOrganizationId || activeOrganizationId !== entityOrganizationId) {
    throw new Error('El recurso no pertenece a la organización activa');
  }
}

export function organizationScope<T extends Record<string, unknown>>(
  organizationId: string,
  where: T,
): T & { organizationId: string } {
  return { ...where, organizationId };
}

