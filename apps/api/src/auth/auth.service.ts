import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ChangePasswordDto, RequestPasswordRecoveryDto, ResetPasswordDto } from './dto/password.dto';
import type { LoginDto } from './dto/login.dto';
import type { JwtPayload } from './auth.types';
import type { AuthenticatedUser } from './auth.types';
import {
  PASSWORD_RECOVERY_DELIVERY,
  type PasswordRecoveryDeliveryPort,
} from './password-recovery/password-recovery-delivery.port';

const PASSWORD_RESET_EXPIRATION_MS = 30 * 60 * 1000;
const PASSWORD_RESET_THROTTLE_MS = 60 * 1000;
const LOGIN_LOCK_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const RECOVERY_MESSAGE = 'Si la cuenta existe, recibirás instrucciones para restablecer la contraseña.';
const DUMMY_PASSWORD_HASH = hash('timing-comparison-only', 12);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(PASSWORD_RECOVERY_DELIVERY)
    private readonly recoveryDelivery: PasswordRecoveryDeliveryPort,
  ) {}

  async login(dto: LoginDto) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        user: { email: dto.email.toLowerCase(), active: true },
        ...(dto.organizationSlug ? { organization: { slug: dto.organizationSlug } } : {}),
      },
      include: { user: true, organization: true },
    });

    const now = new Date();
    const passwordMatches = membership
      ? await compare(dto.password, membership.user.passwordHash)
      : await compare(dto.password, await DUMMY_PASSWORD_HASH);
    const locked = Boolean(membership?.user.lockedUntil && membership.user.lockedUntil > now);
    if (!membership || !passwordMatches || locked) {
      if (membership && !locked) {
        const previousAttempts = membership.user.lockedUntil && membership.user.lockedUntil <= now
          ? 0
          : membership.user.failedLoginAttempts;
        const failedLoginAttempts = previousAttempts + 1;
        const lockedUntil = failedLoginAttempts >= LOGIN_LOCK_ATTEMPTS
          ? new Date(now.getTime() + LOGIN_LOCK_MS)
          : null;
        await this.prisma.user.update({
          where: { id: membership.userId },
          data: { failedLoginAttempts, lockedUntil },
        });
        if (lockedUntil) {
          await this.audit.record({
            organizationId: membership.organizationId,
            action: 'ACCOUNT_TEMPORARILY_LOCKED',
            entityType: 'User',
            entityId: membership.userId,
            payload: { failedLoginAttempts, lockedUntil: lockedUntil.toISOString() },
          });
        }
      }
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    if (membership.user.failedLoginAttempts || membership.user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: membership.userId },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const payload: JwtPayload = {
      sub: membership.userId,
      email: membership.user.email,
      displayName: membership.user.displayName,
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      membershipId: membership.id,
      role: membership.role,
      sessionVersion: membership.user.sessionVersion,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: membership.user.id,
        email: membership.user.email,
        displayName: membership.user.displayName,
        role: membership.role,
        organization: {
          id: membership.organization.id,
          name: membership.organization.name,
          slug: membership.organization.slug,
        },
      },
    };
  }

  async requestPasswordRecovery(dto: RequestPasswordRecoveryDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      include: { memberships: { select: { organizationId: true } } },
    });
    if (!user || !user.active) return { message: RECOVERY_MESSAGE };

    const now = new Date();
    const recentToken = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        consumedAt: null,
        expiresAt: { gt: now },
        createdAt: { gt: new Date(now.getTime() - PASSWORD_RESET_THROTTLE_MS) },
      },
    });
    if (recentToken) return { message: RECOVERY_MESSAGE };

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashRecoveryToken(token);
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_EXPIRATION_MS);
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const webOrigin = this.config.get('WEB_ORIGIN', 'http://localhost:3000').replace(/\/$/, '');
    const resetUrl = `${webOrigin}/restablecer?token=${encodeURIComponent(token)}`;
    const delivery = await this.recoveryDelivery.deliver({
      email: user.email,
      displayName: user.displayName,
      resetUrl,
      expiresAt,
    });
    await Promise.all(user.memberships.map((membership) => this.audit.record({
      organizationId: membership.organizationId,
      action: 'PASSWORD_RECOVERY_REQUESTED',
      entityType: 'User',
      entityId: user.id,
    })));
    return { message: RECOVERY_MESSAGE, ...delivery };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashRecoveryToken(dto.token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: { include: { memberships: { select: { organizationId: true } } } },
      },
    });
    const now = new Date();
    if (!resetToken || resetToken.consumedAt || resetToken.expiresAt <= now || !resetToken.user.active) {
      throw new BadRequestException('El enlace de recuperación es inválido o ya venció');
    }

    const passwordHash = await hash(dto.newPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException('El enlace de recuperación es inválido o ya venció');
      }
      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, consumedAt: null },
        data: { consumedAt: now },
      });
    });
    await Promise.all(resetToken.user.memberships.map((membership) => this.audit.record({
      organizationId: membership.organizationId,
      actorUserId: resetToken.userId,
      action: 'PASSWORD_RECOVERY_COMPLETED',
      entityType: 'User',
      entityId: resetToken.userId,
    })));
    return { ok: true };
  }

  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto) {
    const account = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!account || !(await compare(dto.currentPassword, account.passwordHash))) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }
    if (await compare(dto.newPassword, account.passwordHash)) {
      throw new BadRequestException('La nueva contraseña debe ser diferente a la actual');
    }

    const now = new Date();
    const passwordHash = await hash(dto.newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.userId },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.userId, consumedAt: null },
        data: { consumedAt: now },
      }),
    ]);
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.userId,
    });
    return { ok: true };
  }

  private hashRecoveryToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
