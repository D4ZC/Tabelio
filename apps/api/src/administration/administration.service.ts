import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MatterStatus, MembershipRole } from '@despacho/database';
import { hash } from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateMemberDto, UpdateMemberRoleDto } from './dto/member.dto';

@Injectable()
export class AdministrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listMembers(user: AuthenticatedUser) {
    return this.prisma.membership.findMany({
      where: { organizationId: user.organizationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            active: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createMember(user: AuthenticatedUser, dto: CreateMemberDto) {
    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingMembership = await this.prisma.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: user.organizationId,
            userId: existingUser.id,
          },
        },
      });
      if (existingMembership) throw new ConflictException('El usuario ya pertenece a la organización');
    }

    const passwordHash = await hash(dto.temporaryPassword, 12);
    const membership = await this.prisma.$transaction(async (tx) => {
      const memberUser = existingUser ?? await tx.user.create({
        data: {
          email,
          displayName: dto.displayName.trim(),
          passwordHash,
        },
      });
      return tx.membership.create({
        data: {
          organizationId: user.organizationId,
          userId: memberUser.id,
          role: dto.role,
        },
        include: {
          user: { select: { id: true, email: true, displayName: true, active: true, createdAt: true } },
        },
      });
    });

    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'MEMBER_CREATED',
      entityType: 'Membership',
      entityId: membership.id,
      payload: { email, role: dto.role },
    });
    return membership;
  }

  async updateRole(user: AuthenticatedUser, membershipId: string, dto: UpdateMemberRoleDto) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId: user.organizationId },
      include: { user: { select: { email: true } } },
    });
    if (!membership) throw new NotFoundException('Membresía no encontrada');

    if (membership.role === MembershipRole.ADMIN && dto.role !== MembershipRole.ADMIN) {
      const adminCount = await this.prisma.membership.count({
        where: { organizationId: user.organizationId, role: MembershipRole.ADMIN },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('La organización debe conservar al menos un administrador');
      }
    }
    if (dto.role === MembershipRole.VIEWER && membership.role !== MembershipRole.VIEWER) {
      const activeMatters = await this.prisma.matter.count({
        where: {
          organizationId: user.organizationId,
          responsibleMembershipId: membership.id,
          status: { notIn: [MatterStatus.CLOSED, MatterStatus.CANCELLED] },
        },
      });
      if (activeMatters > 0) {
        throw new BadRequestException(
          `Reasigna ${activeMatters} expediente(s) abierto(s) antes de cambiar este integrante a consulta`,
        );
      }
    }

    const updated = await this.prisma.membership.update({
      where: { id: membership.id },
      data: { role: dto.role },
      include: {
        user: { select: { id: true, email: true, displayName: true, active: true, createdAt: true } },
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'MEMBER_ROLE_CHANGED',
      entityType: 'Membership',
      entityId: membership.id,
      payload: { email: membership.user.email, from: membership.role, to: dto.role },
    });
    return updated;
  }
}
