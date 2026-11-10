import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MatterKind,
  RequirementCompletionMode,
} from '@despacho/database';
import { checklistFor, type MatterKind as DomainMatterKind } from '@despacho/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateRequirementDto, UpdateRequirementDto } from './dto/requirement.dto';

@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser, matterKind?: MatterKind) {
    await this.ensureDefaults(user.organizationId);
    return this.prisma.requirementDefinition.findMany({
      where: { organizationId: user.organizationId, ...(matterKind ? { matterKind } : {}) },
      orderBy: [{ matterKind: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async definitionsFor(organizationId: string, matterKind: MatterKind) {
    await this.ensureDefaults(organizationId);
    return this.prisma.requirementDefinition.findMany({
      where: { organizationId, matterKind, active: true },
      select: {
        code: true,
        label: true,
        blocking: true,
        appliesToRole: true,
        completionMode: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async create(user: AuthenticatedUser, dto: CreateRequirementDto) {
    await this.ensureDefaults(user.organizationId);
    const code = dto.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,40}$/.test(code)) {
      throw new BadRequestException('El código sólo admite letras, números, guion y guion bajo');
    }
    const existing = await this.prisma.requirementDefinition.findUnique({
      where: {
        organizationId_matterKind_code: {
          organizationId: user.organizationId,
          matterKind: dto.matterKind,
          code,
        },
      },
    });
    if (existing) throw new ConflictException('Ya existe un requisito con ese código para el tipo de expediente');
    const last = await this.prisma.requirementDefinition.aggregate({
      where: { organizationId: user.organizationId, matterKind: dto.matterKind },
      _max: { sortOrder: true },
    });
    const requirement = await this.prisma.requirementDefinition.create({
      data: {
        organizationId: user.organizationId,
        matterKind: dto.matterKind,
        code,
        label: dto.label.trim(),
        blocking: dto.blocking,
        appliesToRole: dto.appliesToRole,
        completionMode: RequirementCompletionMode.MANUAL,
        sortOrder: dto.sortOrder ?? (last._max.sortOrder ?? 0) + 10,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'REQUIREMENT_CREATED',
      entityType: 'RequirementDefinition',
      entityId: requirement.id,
      payload: { code, matterKind: dto.matterKind, blocking: dto.blocking },
    });
    return requirement;
  }

  async update(user: AuthenticatedUser, requirementId: string, dto: UpdateRequirementDto) {
    const current = await this.prisma.requirementDefinition.findFirst({
      where: { id: requirementId, organizationId: user.organizationId },
    });
    if (!current) throw new NotFoundException('Requisito no encontrado');
    const requirement = await this.prisma.requirementDefinition.update({
      where: { id: current.id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.blocking !== undefined ? { blocking: dto.blocking } : {}),
        ...(dto.appliesToRole !== undefined ? { appliesToRole: dto.appliesToRole } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'REQUIREMENT_UPDATED',
      entityType: 'RequirementDefinition',
      entityId: requirement.id,
      payload: { code: requirement.code, fields: Object.keys(dto), active: requirement.active },
    });
    return requirement;
  }

  private async ensureDefaults(organizationId: string) {
    const rows = ([MatterKind.LEASE, MatterKind.MEDIATION_AGREEMENT] as const).flatMap((matterKind) => (
      checklistFor(matterKind as DomainMatterKind).map((item, index) => ({
        organizationId,
        matterKind,
        code: item.code,
        label: item.label,
        blocking: item.blocking,
        appliesToRole: item.appliesToRole,
        completionMode: RequirementCompletionMode.AUTO,
        sortOrder: (index + 1) * 10,
      }))
    ));
    await this.prisma.requirementDefinition.createMany({ data: rows, skipDuplicates: true });
  }
}
