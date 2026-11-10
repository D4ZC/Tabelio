import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type MembershipRole, type Permission } from '@despacho/domain';
import type { Request } from 'express';
import type { AuthenticatedUser } from './auth.types';
import { REQUIRED_PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permissions = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permissions?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const role = request.user?.role as MembershipRole | undefined;
    if (!role || !permissions.every((permission) => hasPermission(role, permission))) {
      throw new ForbiddenException('Tu rol no permite realizar esta acción');
    }
    return true;
  }
}

