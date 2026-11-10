import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClauseVersionStatus, MatterKind, MatterStatus } from '@despacho/database';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateClauseDto, CreateClauseVersionDto, SelectMatterClausesDto } from './dto/clause.dto';

const SELECTABLE_MATTER_STATUSES: MatterStatus[] = [
  MatterStatus.DRAFT,
  MatterStatus.INTEGRATION,
  MatterStatus.PENDING_CLIENT,
  MatterStatus.VALIDATION,
  MatterStatus.READY_TO_DRAFT,
  MatterStatus.DRAFTING,
];

@Injectable()
export class ClausesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(user: AuthenticatedUser, matterKind?: MatterKind) {
    return this.prisma.clause.findMany({
      where: {
        organizationId: user.organizationId,
        ...(matterKind ? { matterKind } : {}),
      },
      include: {
        createdBy: { select: { id: true, displayName: true } },
        versions: {
          include: {
            createdBy: { select: { id: true, displayName: true } },
            approvedBy: { select: { id: true, displayName: true } },
          },
          orderBy: { version: 'desc' },
        },
      },
      orderBy: [{ matterKind: 'asc' }, { code: 'asc' }],
    });
  }

  async create(user: AuthenticatedUser, dto: CreateClauseDto) {
    const code = dto.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,40}$/.test(code)) {
      throw new BadRequestException('El código sólo admite letras, números, guion y guion bajo');
    }
    const existing = await this.prisma.clause.findUnique({
      where: { organizationId_code: { organizationId: user.organizationId, code } },
    });
    if (existing) throw new ConflictException('Ya existe una cláusula con ese código');

    const clause = await this.prisma.clause.create({
      data: {
        organizationId: user.organizationId,
        code,
        title: dto.title.trim(),
        category: dto.category?.trim() || null,
        matterKind: dto.matterKind,
        createdById: user.userId,
        versions: {
          create: {
            organizationId: user.organizationId,
            version: 1,
            body: dto.body.trim(),
            createdById: user.userId,
          },
        },
      },
      include: { versions: true },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'CLAUSE_CREATED',
      entityType: 'Clause',
      entityId: clause.id,
      payload: { code, matterKind: dto.matterKind, version: 1 },
    });
    return clause;
  }

  async createVersion(user: AuthenticatedUser, clauseId: string, dto: CreateClauseVersionDto) {
    const clause = await this.prisma.clause.findFirst({
      where: { id: clauseId, organizationId: user.organizationId, active: true },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!clause) throw new NotFoundException('Cláusula no encontrada');
    if (clause.versions.some((version) => version.status === ClauseVersionStatus.DRAFT)) {
      throw new ConflictException('Aprueba o descarta el borrador existente antes de crear otra versión');
    }

    const version = await this.prisma.clauseVersion.create({
      data: {
        organizationId: user.organizationId,
        clauseId: clause.id,
        version: (clause.versions[0]?.version ?? 0) + 1,
        body: dto.body.trim(),
        createdById: user.userId,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'CLAUSE_VERSION_CREATED',
      entityType: 'ClauseVersion',
      entityId: version.id,
      payload: { clauseId: clause.id, code: clause.code, version: version.version },
    });
    return version;
  }

  async approveVersion(user: AuthenticatedUser, clauseId: string, versionId: string) {
    const version = await this.prisma.clauseVersion.findFirst({
      where: {
        id: versionId,
        clauseId,
        organizationId: user.organizationId,
        status: ClauseVersionStatus.DRAFT,
      },
      include: { clause: true },
    });
    if (!version) throw new NotFoundException('Versión borrador no encontrada');
    const now = new Date();
    const approved = await this.prisma.$transaction(async (tx) => {
      await tx.clauseVersion.updateMany({
        where: {
          clauseId,
          organizationId: user.organizationId,
          status: ClauseVersionStatus.APPROVED,
        },
        data: { status: ClauseVersionStatus.RETIRED },
      });
      return tx.clauseVersion.update({
        where: { id: version.id },
        data: {
          status: ClauseVersionStatus.APPROVED,
          approvedById: user.userId,
          approvedAt: now,
        },
        include: { approvedBy: { select: { id: true, displayName: true } } },
      });
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'CLAUSE_VERSION_APPROVED',
      entityType: 'ClauseVersion',
      entityId: version.id,
      payload: { clauseId, code: version.clause.code, version: version.version },
    });
    return approved;
  }

  listMatterSelections(user: AuthenticatedUser, matterId: string) {
    return this.prisma.matterClauseSelection.findMany({
      where: { organizationId: user.organizationId, matterId },
      include: {
        clause: true,
        clauseVersion: true,
        selectedBy: { select: { id: true, displayName: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async selectForMatter(user: AuthenticatedUser, matterId: string, dto: SelectMatterClausesDto) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (!SELECTABLE_MATTER_STATUSES.includes(matter.status)) {
      throw new BadRequestException('Las cláusulas quedan bloqueadas cuando el documento entra a revisión');
    }

    const versions = await this.prisma.clauseVersion.findMany({
      where: { id: { in: dto.clauseVersionIds }, organizationId: user.organizationId },
      include: { clause: true },
    });
    if (versions.length !== dto.clauseVersionIds.length) {
      throw new BadRequestException('Una o más versiones de cláusula no existen');
    }
    const byId = new Map(versions.map((version) => [version.id, version]));
    const ordered = dto.clauseVersionIds.map((id) => byId.get(id)!);
    const existingSelections = await this.prisma.matterClauseSelection.findMany({
      where: { organizationId: user.organizationId, matterId },
      select: { clauseVersionId: true },
    });
    const previouslySelectedIds = new Set(existingSelections.map((selection) => selection.clauseVersionId));
    for (const version of ordered) {
      if (
        (
          version.status !== ClauseVersionStatus.APPROVED
          && !previouslySelectedIds.has(version.id)
        )
        || !version.clause.active
        || version.clause.matterKind !== matter.kind
      ) {
        throw new BadRequestException(`La cláusula ${version.clause.code} no es seleccionable para este expediente`);
      }
    }
    if (new Set(ordered.map((version) => version.clauseId)).size !== ordered.length) {
      throw new BadRequestException('Selecciona una sola versión por cláusula');
    }

    const selections = await this.prisma.$transaction(async (tx) => {
      await tx.matterClauseSelection.deleteMany({
        where: { organizationId: user.organizationId, matterId },
      });
      if (ordered.length) {
        await tx.matterClauseSelection.createMany({
          data: ordered.map((version, index) => ({
            organizationId: user.organizationId,
            matterId,
            clauseId: version.clauseId,
            clauseVersionId: version.id,
            sortOrder: index + 1,
            selectedById: user.userId,
          })),
        });
      }
      return tx.matterClauseSelection.findMany({
        where: { organizationId: user.organizationId, matterId },
        include: { clause: true, clauseVersion: true },
        orderBy: { sortOrder: 'asc' },
      });
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'MATTER_CLAUSES_SELECTED',
      entityType: 'Matter',
      entityId: matterId,
      payload: {
        clauses: selections.map((selection) => ({
          code: selection.clause.code,
          version: selection.clauseVersion.version,
        })),
      },
    });
    return selections;
  }
}
