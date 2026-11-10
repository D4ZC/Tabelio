import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import { extractSessionToken } from './session-token';
import type { AuthenticatedUser, JwtPayload } from './auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const token = extractSessionToken(request);
    if (!token) throw new UnauthorizedException('Falta una sesión válida');

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const membership = await this.prisma.membership.findFirst({
        where: {
          id: payload.membershipId,
          userId: payload.sub,
          organizationId: payload.organizationId,
          user: { active: true, sessionVersion: payload.sessionVersion },
        },
        include: { user: true, organization: true },
      });
      if (!membership) throw new UnauthorizedException('La sesión dejó de ser válida');
      request.user = {
        userId: membership.userId,
        email: membership.user.email,
        displayName: membership.user.displayName,
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        membershipId: membership.id,
        role: membership.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o vencido');
    }
  }
}
