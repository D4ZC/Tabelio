import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ChecklistStatus,
  MatterKind,
  MembershipRole,
  MatterPartyRole,
  MatterStatus,
  Prisma,
  ReminderStatus,
  ReminderType,
  RequirementCompletionMode,
  SignatureStatus,
  TaskSource,
  TaskStatus,
} from '@despacho/database';
import {
  assertTransition,
  currentDocuments,
  evaluateReadiness,
  isChecklistItemComplete,
  renewalAlertFor,
  validateMatterConsistency,
  type ChecklistSnapshot,
  type MatterStatus as DomainMatterStatus,
} from '@despacho/domain';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequirementsService } from '../requirements/requirements.service';
import type { CreateMatterDto, UpdateMatterDto } from './dto/create-matter.dto';
import type { WaiveChecklistItemDto } from './dto/checklist.dto';
import type { AddMatterPartyDto } from './dto/matter-party.dto';
import type { UpsertLeaseTermsDto, UpsertMediationTermsDto } from './dto/terms.dto';
import type { TransitionMatterDto } from './dto/transition.dto';
import type { CreateRenewalDto } from './dto/renewal.dto';
import type { ListMattersQueryDto } from './dto/list-matters.dto';

const RENEWAL_TRACKED_STATUSES = new Set<MatterStatus>([
  MatterStatus.ACTIVE,
  MatterStatus.RENEWAL_DUE,
]);
const FINISHED_STATUSES = new Set<MatterStatus>([MatterStatus.CLOSED, MatterStatus.CANCELLED]);
const INTEGRATION_STATUSES = new Set<MatterStatus>([
  MatterStatus.DRAFT,
  MatterStatus.INTEGRATION,
  MatterStatus.PENDING_CLIENT,
  MatterStatus.VALIDATION,
]);

@Injectable()
export class MattersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly requirements: RequirementsService,
  ) {}

  private listWhere(user: AuthenticatedUser, query: ListMattersQueryDto): Prisma.MatterWhereInput {
    const text = query.q?.trim();
    const contains = text ? { contains: text, mode: 'insensitive' as const } : undefined;
    return {
      organizationId: user.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(contains ? {
        OR: [
          { reference: contains },
          { title: contains },
          { notes: contains },
          { property: { displayName: contains } },
          { mediationTerms: { agreementNumber: contains } },
          { parties: { some: { person: { legalName: contains } } } },
        ],
      } : {}),
    };
  }

  /** Página de expedientes con total, para organizaciones con miles de asuntos. */
  async page(user: AuthenticatedUser, query: ListMattersQueryDto = {}, asOf = new Date()) {
    const take = query.take ?? 50;
    const skip = query.skip ?? 0;
    const [items, total] = await Promise.all([
      this.list(user, { ...query, take, skip }, asOf),
      this.prisma.matter.count({ where: this.listWhere(user, query) }),
    ]);
    return { items, total, take, skip };
  }

  /** Lista ligera para selectores: evita transferir el detalle de miles de expedientes. */
  listOptions(user: AuthenticatedUser, query: ListMattersQueryDto = {}) {
    return this.prisma.matter.findMany({
      where: this.listWhere(user, query),
      ...(query.take ? { take: query.take } : {}),
      ...(query.skip ? { skip: query.skip } : {}),
      select: { id: true, reference: true, title: true, kind: true, status: true, propertyId: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async list(
    user: AuthenticatedUser,
    query: ListMattersQueryDto = {},
    asOf = new Date(),
  ) {
    const matters = await this.prisma.matter.findMany({
      where: this.listWhere(user, query),
      ...(query.take ? { take: query.take } : {}),
      ...(query.skip ? { skip: query.skip } : {}),
      include: {
        property: { select: { id: true, displayName: true, city: true, state: true } },
        responsible: { include: { user: { select: { id: true, displayName: true } } } },
        leaseTerms: { select: { endDate: true } },
        relatedMatters: {
          where: { kind: MatterKind.LEASE, status: { notIn: [MatterStatus.CLOSED, MatterStatus.CANCELLED] } },
          select: { id: true, reference: true, status: true },
        },
        cancelledBy: { select: { id: true, displayName: true } },
        _count: { select: { parties: true, documents: true, checklistItems: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    return matters.map((matter) => ({
      ...matter,
      renewal: matter.kind === MatterKind.LEASE && matter.leaseTerms
        ? renewalAlertFor(matter.leaseTerms.endDate, asOf)
        : undefined,
      openRenewal: matter.relatedMatters[0],
    }));
  }

  async dashboard(user: AuthenticatedUser, asOf = new Date()) {
    // Conteos agregados en base de datos: el listado completo no escala a miles de expedientes.
    const [statusCounts, activated, renewalCandidates] = await Promise.all([
      this.prisma.matter.groupBy({ by: ['status'], where: { organizationId: user.organizationId }, _count: { _all: true } }),
      this.prisma.matter.findMany({
        where: { organizationId: user.organizationId, activatedAt: { not: null } },
        select: { createdAt: true, activatedAt: true },
      }),
      this.list(user, { kind: MatterKind.LEASE }, asOf),
    ]);
    const countOf = (statuses: Iterable<MatterStatus>) => {
      const wanted = new Set(statuses);
      return statusCounts.reduce((total, row) => total + (wanted.has(row.status) ? row._count._all : 0), 0);
    };
    // Expedientes importados pueden registrar la activación antes del alta capturada; se excluyen del promedio.
    const durations = activated
      .map((matter) => (matter.activatedAt!.getTime() - matter.createdAt.getTime()) / 86_400_000)
      .filter((days) => days >= 0);
    const averageDaysToActivation = durations.length
      ? Math.round(durations.reduce((total, days) => total + days, 0) / durations.length * 10) / 10
      : null;
    const alerts = renewalCandidates
      .filter((matter) => (
        matter.renewal
        && matter.renewal.level !== 'NONE'
        && RENEWAL_TRACKED_STATUSES.has(matter.status)
      ))
      .map((matter) => ({
        matterId: matter.id,
        reference: matter.reference,
        title: matter.title,
        status: matter.status,
        property: matter.property,
        responsible: matter.responsible?.user,
        renewal: matter.renewal!,
        openRenewal: matter.openRenewal,
      }))
      .sort((left, right) => left.renewal.daysRemaining - right.renewal.daysRemaining);
    return {
      asOf: asOf.toISOString(),
      metrics: {
        open: countOf(Object.values(MatterStatus).filter((status) => !FINISHED_STATUSES.has(status))),
        integration: countOf(INTEGRATION_STATUSES),
        signature: countOf([MatterStatus.SIGNATURE]),
        review: countOf([MatterStatus.REVIEW]),
        approval: countOf([MatterStatus.APPROVAL]),
        active: countOf([MatterStatus.ACTIVE]),
        termination: countOf([MatterStatus.TERMINATION]),
        closed: countOf([MatterStatus.CLOSED]),
        renewalWindow: alerts.length,
        expired: alerts.filter((alert) => alert.renewal.level === 'EXPIRED').length,
        averageDaysToActivation,
      },
      alerts,
    };
  }

  async get(user: AuthenticatedUser, id: string) {
    await this.refreshChecklist(user, id);
    const matter = await this.prisma.matter.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        property: true,
        guaranteeProperty: true,
        responsible: {
          include: { user: { select: { id: true, displayName: true, email: true, active: true } } },
        },
        linkedMatter: { select: { id: true, reference: true, title: true, kind: true, status: true, propertyId: true } },
        relatedMatters: {
          where: { kind: MatterKind.LEASE, status: { notIn: [MatterStatus.CLOSED, MatterStatus.CANCELLED] } },
          select: { id: true, reference: true, title: true, kind: true, status: true },
        },
        cancelledBy: { select: { id: true, displayName: true } },
        parties: { include: { person: true }, orderBy: { createdAt: 'asc' } },
        leaseTerms: true,
        mediationTerms: true,
        checklistItems: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        clauseSelections: {
          include: {
            clause: true,
            clauseVersion: true,
            selectedBy: { select: { id: true, displayName: true } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        documents: {
          include: {
            libraryLinks: {
              where: { organizationId: user.organizationId },
              select: { libraryDocument: { select: { id: true, source: true, documentTypeLabel: true, packageLabel: true } } },
            },
            invalidatedBy: { select: { id: true, displayName: true } },
            sourceDocument: {
              select: { id: true, originalName: true, type: true, version: true, checksum: true },
            },
            derivedDocuments: {
              select: { id: true, originalName: true, type: true, version: true, checksum: true },
              orderBy: { createdAt: 'asc' },
            },
            clauseSnapshots: { orderBy: { sortOrder: 'asc' } },
            reviews: {
              include: { reviewer: { select: { id: true, displayName: true } } },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        signatureRequests: {
          include: {
            sourceDocument: { select: { id: true, originalName: true, version: true } },
            signedDocument: { select: { id: true, originalName: true, version: true } },
            requestedBy: { select: { id: true, displayName: true } },
            completedBy: { select: { id: true, displayName: true } },
            cancelledBy: { select: { id: true, displayName: true } },
          },
          orderBy: { requestedAt: 'desc' },
        },
        terminationProcesses: {
          include: {
            evidenceDocument: { select: { id: true, originalName: true, version: true } },
            startedBy: { select: { id: true, displayName: true } },
            cancelledBy: { select: { id: true, displayName: true } },
            closedBy: { select: { id: true, displayName: true } },
          },
          orderBy: { startedAt: 'desc' },
        },
        tasks: {
          include: {
            assignee: {
              select: {
                id: true,
                role: true,
                user: { select: { id: true, displayName: true, email: true, active: true } },
              },
            },
            createdBy: { select: { id: true, displayName: true } },
            completedBy: { select: { id: true, displayName: true } },
            blockedBy: { select: { id: true, displayName: true } },
            dueDateChanges: {
              include: { changedBy: { select: { id: true, displayName: true } } },
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
            comments: {
              include: { author: { select: { id: true, displayName: true } } },
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
            evidenceLinks: {
              include: {
                document: {
                  select: {
                    id: true,
                    type: true,
                    originalName: true,
                    mimeType: true,
                    version: true,
                    expiresAt: true,
                    invalidatedAt: true,
                    createdAt: true,
                  },
                },
                linkedBy: { select: { id: true, displayName: true } },
              },
              orderBy: { linkedAt: 'desc' },
            },
            prerequisites: {
              include: {
                dependsOnTask: {
                  select: {
                    id: true,
                    title: true,
                    status: true,
                    priority: true,
                    dueAt: true,
                    source: true,
                  },
                },
                createdBy: { select: { id: true, displayName: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        },
        auditEvents: {
          include: { actor: { select: { id: true, displayName: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    const operationalDocuments = currentDocuments(matter.documents);
    const operationalDocumentIds = new Set(operationalDocuments.map((document) => document.id));
    const consistency = validateMatterConsistency({
      kind: matter.kind,
      propertyId: matter.propertyId,
      guaranteePropertyId: matter.guaranteePropertyId,
      linkedMatterId: matter.linkedMatterId,
      linkedPropertyId: matter.linkedMatter?.propertyId,
      parties: matter.parties.map((party) => ({ role: party.role, personId: party.personId })),
      documents: operationalDocuments,
      leaseTerms: matter.leaseTerms,
    });
    const pendingChecklist = matter.checklistItems.filter((item) => item.status === ChecklistStatus.PENDING);
    const readiness = evaluateReadiness({
      blockingPending: pendingChecklist.filter((item) => item.blocking).length,
      nonBlockingPending: pendingChecklist.filter((item) => !item.blocking).length,
      highWarnings: consistency.high,
      mediumWarnings: consistency.medium,
    });
    return {
      ...matter,
      documents: matter.documents.map((document) => ({
        ...document,
        isCurrentVersion: operationalDocumentIds.has(document.id),
      })),
      renewal: matter.kind === MatterKind.LEASE && matter.leaseTerms
        ? renewalAlertFor(matter.leaseTerms.endDate)
        : undefined,
      openRenewal: matter.relatedMatters[0],
      consistency: { evaluatedAt: new Date().toISOString(), ...consistency },
      readiness,
    };
  }

  async createRenewal(user: AuthenticatedUser, sourceMatterId: string, dto: CreateRenewalDto) {
    const source = await this.prisma.matter.findFirst({
      where: { id: sourceMatterId, organizationId: user.organizationId },
      include: {
        leaseTerms: true,
        parties: { orderBy: { createdAt: 'asc' } },
        relatedMatters: {
          where: {
            kind: MatterKind.LEASE,
            status: { notIn: [MatterStatus.CLOSED, MatterStatus.CANCELLED] },
          },
          select: { id: true, reference: true },
        },
      },
    });
    if (!source) throw new NotFoundException('Expediente origen no encontrado');
    if (source.kind !== MatterKind.LEASE || !source.leaseTerms) {
      throw new BadRequestException('La renovación requiere un arrendamiento con condiciones vigentes');
    }
    if (!RENEWAL_TRACKED_STATUSES.has(source.status)) {
      throw new BadRequestException('Sólo se renuevan arrendamientos activos o por renovar');
    }
    if (source.relatedMatters.length > 0) {
      throw new BadRequestException(`Ya existe una renovación abierta (${source.relatedMatters[0].reference})`);
    }
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (startDate <= source.leaseTerms.endDate) {
      throw new BadRequestException('La nueva vigencia debe iniciar después de finalizar el contrato actual');
    }
    if (endDate <= startDate) {
      throw new BadRequestException('La fecha final de la renovación debe ser posterior a su inicio');
    }

    const reference = `EXP-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const definitions = await this.requirements.definitionsFor(user.organizationId, MatterKind.LEASE);
    const renewal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.matter.create({
        data: {
          organizationId: user.organizationId,
          reference,
          title: `Renovación · ${source.title}`,
          kind: MatterKind.LEASE,
          status: MatterStatus.INTEGRATION,
          propertyId: source.propertyId,
          guaranteePropertyId: source.guaranteePropertyId,
          linkedMatterId: source.id,
          responsibleMembershipId: source.responsibleMembershipId ?? user.membershipId,
          createdById: user.userId,
          notes: dto.notes?.trim() || `Renovación del expediente ${source.reference}`,
        },
      });
      await tx.matterParty.createMany({
        data: source.parties.map((party) => ({
          organizationId: user.organizationId,
          matterId: created.id,
          personId: party.personId,
          role: party.role,
          isPrimary: party.isPrimary,
        })),
      });
      await tx.checklistItem.createMany({
        data: definitions.map((item) => ({
          code: item.code,
          label: item.label,
          blocking: item.blocking,
          appliesToRole: item.appliesToRole,
          completionMode: item.completionMode,
          sortOrder: item.sortOrder,
          organizationId: user.organizationId,
          matterId: created.id,
        })),
      });
      await tx.leaseTerms.create({
        data: {
          organizationId: user.organizationId,
          matterId: created.id,
          rentAmount: dto.rentAmount ?? source.leaseTerms!.rentAmount,
          currency: source.leaseTerms!.currency,
          depositAmount: source.leaseTerms!.depositAmount,
          prepaidRentAmount: source.leaseTerms!.prepaidRentAmount,
          totalInitialPayment: source.leaseTerms!.totalInitialPayment,
          dueDay: source.leaseTerms!.dueDay,
          paymentMethod: source.leaseTerms!.paymentMethod,
          maintenanceIncluded: source.leaseTerms!.maintenanceIncluded,
          startDate,
          endDate,
          durationMonths: dto.durationMonths,
          noticeDays: source.leaseTerms!.noticeDays,
          lateFeePercent: source.leaseTerms!.lateFeePercent,
          holdoverSurchargePercent: source.leaseTerms!.holdoverSurchargePercent,
          earlyTerminationPenaltyMonths: source.leaseTerms!.earlyTerminationPenaltyMonths,
        },
      });
      if (source.status === MatterStatus.ACTIVE) {
        await tx.matter.update({
          where: { id: source.id },
          data: { status: MatterStatus.RENEWAL_DUE },
        });
      }
      return created;
    });

    await this.audit.record({
      organizationId: user.organizationId,
      matterId: source.id,
      actorUserId: user.userId,
      action: 'RENEWAL_STARTED',
      entityType: 'Matter',
      entityId: source.id,
      payload: { renewalMatterId: renewal.id, renewalReference: reference },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: renewal.id,
      actorUserId: user.userId,
      action: 'RENEWAL_MATTER_CREATED',
      entityType: 'Matter',
      entityId: renewal.id,
      payload: { sourceMatterId: source.id, sourceReference: source.reference },
    });
    return this.get(user, renewal.id);
  }

  async create(user: AuthenticatedUser, dto: CreateMatterDto) {
    await this.validateReferences(user, dto);
    const responsibleMembershipId = dto.responsibleMembershipId ?? user.membershipId;
    const responsible = await this.ensureEligibleResponsible(user.organizationId, responsibleMembershipId);
    const reference = `EXP-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const definitions = await this.requirements.definitionsFor(user.organizationId, dto.kind);

    const matter = await this.prisma.$transaction(async (tx) => {
      const created = await tx.matter.create({
        data: {
          ...dto,
          reference,
          organizationId: user.organizationId,
          createdById: user.userId,
          responsibleMembershipId,
        },
      });
      await tx.checklistItem.createMany({
        data: definitions.map((item) => ({
          code: item.code,
          label: item.label,
          blocking: item.blocking,
          appliesToRole: item.appliesToRole,
          completionMode: item.completionMode,
          sortOrder: item.sortOrder,
          organizationId: user.organizationId,
          matterId: created.id,
        })),
      });
      return created;
    });

    await this.audit.record({
      organizationId: user.organizationId,
      matterId: matter.id,
      actorUserId: user.userId,
      action: 'MATTER_CREATED',
      entityType: 'Matter',
      entityId: matter.id,
      payload: { kind: matter.kind, reference, responsibleMembershipId },
    });
    await this.notifications.notifyMatterAssignment({
      organizationId: user.organizationId,
      matterId: matter.id,
      recipientUserId: responsible.userId,
      reference: matter.reference,
      title: matter.title,
    }).catch(() => undefined);
    return this.get(user, matter.id);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateMatterDto) {
    const matter = await this.ensureMatter(user, id);
    this.assertMatterOpenForEditing(matter);
    await this.validateReferences(user, dto);
    await this.prisma.matter.update({
      where: { id },
      data: dto,
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: id,
      actorUserId: user.userId,
      action: 'MATTER_UPDATED',
      entityType: 'Matter',
      entityId: id,
      payload: { ...dto },
    });
    return this.get(user, id);
  }

  async assignResponsible(user: AuthenticatedUser, id: string, responsibleMembershipId: string) {
    const matter = await this.ensureMatter(user, id);
    this.assertMatterOpenForEditing(matter);
    const responsible = await this.ensureEligibleResponsible(
      user.organizationId,
      responsibleMembershipId,
    );
    if (matter.responsibleMembershipId === responsible.id) return this.get(user, id);

    const propagation = await this.prisma.$transaction(async (tx) => {
      await tx.matter.update({
        where: { id: matter.id },
        data: { responsibleMembershipId: responsible.id },
      });
      const tasks = await tx.task.updateMany({
        where: {
          organizationId: user.organizationId,
          matterId: matter.id,
          source: TaskSource.SYSTEM,
          status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] },
        },
        data: { assigneeMembershipId: responsible.id },
      });
      const reminders = await tx.reminder.updateMany({
        where: {
          organizationId: user.organizationId,
          matterId: matter.id,
          type: ReminderType.RENEWAL,
          status: { in: [ReminderStatus.SCHEDULED, ReminderStatus.DUE] },
        },
        data: { recipientUserId: responsible.userId },
      });
      return { tasks: tasks.count, reminders: reminders.count };
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: matter.id,
      actorUserId: user.userId,
      action: 'MATTER_RESPONSIBLE_CHANGED',
      entityType: 'Matter',
      entityId: matter.id,
      payload: {
        fromMembershipId: matter.responsibleMembershipId,
        toMembershipId: responsible.id,
        toUserId: responsible.userId,
        tasksReassigned: propagation.tasks,
        remindersReassigned: propagation.reminders,
      },
    });
    await this.notifications.notifyMatterAssignment({
      organizationId: user.organizationId,
      matterId: matter.id,
      recipientUserId: responsible.userId,
      reference: matter.reference,
      title: matter.title,
    }).catch(() => undefined);
    const reassignedTasks = await this.prisma.task.findMany({
      where: {
        organizationId: user.organizationId,
        matterId: matter.id,
        source: TaskSource.SYSTEM,
        status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] },
      },
      select: { id: true, title: true, assigneeMembershipId: true },
    });
    for (const task of reassignedTasks) {
      await this.notifications.notifyTaskAssignment({
        organizationId: user.organizationId,
        matterId: matter.id,
        taskId: task.id,
        taskTitle: task.title,
        assigneeMembershipId: task.assigneeMembershipId,
      }).catch(() => undefined);
    }
    return this.get(user, id);
  }

  async addParty(user: AuthenticatedUser, matterId: string, dto: AddMatterPartyDto) {
    const matter = await this.ensureMatter(user, matterId);
    this.assertMatterOpenForEditing(matter);
    const person = await this.prisma.person.findFirst({
      where: { id: dto.personId, organizationId: user.organizationId },
    });
    if (!person) throw new NotFoundException('Persona no encontrada');

    const party = await this.prisma.matterParty.upsert({
      where: { matterId_personId_role: { matterId, personId: dto.personId, role: dto.role } },
      update: { isPrimary: dto.isPrimary ?? true },
      create: {
        ...dto,
        isPrimary: dto.isPrimary ?? true,
        matterId,
        organizationId: user.organizationId,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'PARTY_ADDED',
      entityType: 'MatterParty',
      entityId: party.id,
      payload: { personId: dto.personId, role: dto.role },
    });
    return this.get(user, matterId);
  }

  async upsertLeaseTerms(user: AuthenticatedUser, matterId: string, dto: UpsertLeaseTermsDto) {
    const matter = await this.ensureMatter(user, matterId);
    this.assertMatterOpenForEditing(matter);
    if (matter.kind !== MatterKind.LEASE && !matter.linkedMatterId) {
      throw new BadRequestException('Las condiciones de renta requieren un expediente de arrendamiento');
    }
    const data = {
      ...dto,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    };
    await this.prisma.leaseTerms.upsert({
      where: { matterId },
      update: data,
      create: { ...data, matterId, organizationId: user.organizationId },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'LEASE_TERMS_SAVED',
      entityType: 'LeaseTerms',
      entityId: matterId,
    });
    await this.notifications.scheduleMatterReminders(user.organizationId, matterId).catch(() => []);
    return this.get(user, matterId);
  }

  async upsertMediationTerms(user: AuthenticatedUser, matterId: string, dto: UpsertMediationTermsDto) {
    const matter = await this.ensureMatter(user, matterId);
    this.assertMatterOpenForEditing(matter);
    if (matter.kind !== MatterKind.MEDIATION_AGREEMENT) {
      throw new BadRequestException('Los datos de mediación sólo aplican a convenios');
    }
    const data = { ...dto, hearingAt: dto.hearingAt ? new Date(dto.hearingAt) : undefined };
    await this.prisma.mediationTerms.upsert({
      where: { matterId },
      update: data,
      create: { ...data, matterId, organizationId: user.organizationId },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'MEDIATION_TERMS_SAVED',
      entityType: 'MediationTerms',
      entityId: matterId,
    });
    return this.get(user, matterId);
  }

  async transition(user: AuthenticatedUser, id: string, dto: TransitionMatterDto) {
    const matter = await this.ensureMatter(user, id);
    if (dto.status === MatterStatus.CANCELLED) {
      throw new BadRequestException('Usa el flujo de cancelación para registrar motivo, responsable y cierre operativo');
    }
    if (
      (matter.status === MatterStatus.REVIEW
        && (dto.status === MatterStatus.DRAFTING || dto.status === MatterStatus.APPROVAL))
      || (matter.status === MatterStatus.APPROVAL
        && (dto.status === MatterStatus.DRAFTING || dto.status === MatterStatus.SIGNATURE))
    ) {
      throw new BadRequestException('Esta transición requiere registrar una decisión sobre el documento vigente');
    }
    if (matter.status === MatterStatus.SIGNATURE && dto.status === MatterStatus.ACTIVE) {
      throw new BadRequestException('La activación ocurre al registrar el contrato firmado');
    }
    if (matter.status === MatterStatus.SIGNATURE && dto.status === MatterStatus.APPROVAL) {
      const pendingSignature = await this.prisma.signatureRequest.count({
        where: {
          organizationId: user.organizationId,
          matterId: id,
          status: 'PENDING',
        },
      });
      if (pendingSignature > 0) {
        throw new BadRequestException('Cancela la solicitud de firma pendiente antes de volver a aprobación');
      }
    }
    if (
      ((matter.status === MatterStatus.ACTIVE || matter.status === MatterStatus.RENEWAL_DUE)
        && (dto.status === MatterStatus.TERMINATION || dto.status === MatterStatus.CLOSED))
      || (matter.status === MatterStatus.TERMINATION
        && (dto.status === MatterStatus.ACTIVE || dto.status === MatterStatus.CLOSED))
    ) {
      throw new BadRequestException('Esta transición requiere el flujo controlado de terminación');
    }
    if (matter.status === MatterStatus.DRAFTING && dto.status === MatterStatus.REVIEW) {
      const latestDraft = await this.prisma.document.findFirst({
        where: {
          organizationId: user.organizationId,
          matterId: id,
          type: 'DRAFT_CONTRACT',
        },
        include: {
          reviews: { orderBy: { createdAt: 'desc' }, take: 1 },
          derivedDocuments: {
            where: { type: 'DRAFT_CONTRACT_PDF' },
            select: { id: true },
            take: 1,
          },
        },
        orderBy: { version: 'desc' },
      });
      if (!latestDraft) {
        throw new BadRequestException('Genera un borrador contractual antes de enviarlo a revisión');
      }
      if (!latestDraft.derivedDocuments.length) {
        throw new BadRequestException('Genera y verifica la vista previa PDF de la versión vigente antes de enviarla a revisión');
      }
      if (latestDraft.reviews[0]?.decision === 'CHANGES_REQUESTED') {
        throw new BadRequestException('Genera una nueva versión que atienda los cambios solicitados');
      }
    }
    try {
      assertTransition(matter.status as DomainMatterStatus, dto.status as DomainMatterStatus);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    if (dto.status === MatterStatus.READY_TO_DRAFT) {
      await this.refreshChecklist(user, id);
      const pending = await this.prisma.checklistItem.count({
        where: {
          organizationId: user.organizationId,
          matterId: id,
          blocking: true,
          status: ChecklistStatus.PENDING,
        },
      });
      if (pending > 0) {
        throw new BadRequestException(`El expediente conserva ${pending} requisito(s) bloqueante(s)`);
      }
    }

    await this.prisma.matter.update({ where: { id }, data: { status: dto.status } });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: id,
      actorUserId: user.userId,
      action: 'MATTER_STATUS_CHANGED',
      entityType: 'Matter',
      entityId: id,
      payload: { from: matter.status, to: dto.status, comment: dto.comment },
    });
    return this.get(user, id);
  }

  async cancel(user: AuthenticatedUser, id: string, rawReason: string) {
    const reason = rawReason.trim();
    if (reason.length < 10) {
      throw new BadRequestException('El motivo de cancelación debe tener al menos 10 caracteres');
    }
    const matter = await this.ensureMatter(user, id);
    try {
      assertTransition(matter.status as DomainMatterStatus, MatterStatus.CANCELLED as DomainMatterStatus);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const cancelledAt = new Date();
    const propagation = await this.prisma.$transaction(async (tx) => {
      const [tasks, invitations, signatures] = await Promise.all([
        tx.task.updateMany({
          where: {
            organizationId: user.organizationId,
            matterId: id,
            status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] },
          },
          data: {
            status: TaskStatus.CANCELLED,
            completedAt: null,
            completedById: null,
            blockedReason: null,
            blockedAt: null,
            blockedById: null,
          },
        }),
        tx.portalInvitation.updateMany({
          where: { organizationId: user.organizationId, matterId: id, revokedAt: null },
          data: { revokedAt: cancelledAt },
        }),
        tx.signatureRequest.updateMany({
          where: {
            organizationId: user.organizationId,
            matterId: id,
            status: SignatureStatus.PENDING,
          },
          data: {
            status: SignatureStatus.CANCELLED,
            cancelledAt,
            cancelledById: user.userId,
            notes: reason,
          },
        }),
      ]);
      await tx.matter.update({
        where: { id },
        data: {
          status: MatterStatus.CANCELLED,
          cancelledAt,
          cancellationReason: reason,
          cancelledById: user.userId,
        },
      });
      return {
        tasksCancelled: tasks.count,
        invitationsRevoked: invitations.count,
        signaturesCancelled: signatures.count,
      };
    });

    await this.audit.record({
      organizationId: user.organizationId,
      matterId: id,
      actorUserId: user.userId,
      action: 'MATTER_CANCELLED',
      entityType: 'Matter',
      entityId: id,
      payload: {
        from: matter.status,
        to: MatterStatus.CANCELLED,
        reason,
        cancelledAt: cancelledAt.toISOString(),
        ...propagation,
      },
    });
    await this.notifications.cancelMatterNotifications(user.organizationId, id).catch(() => undefined);
    return this.get(user, id);
  }

  async waiveChecklistItem(
    user: AuthenticatedUser,
    matterId: string,
    checklistItemId: string,
    dto: WaiveChecklistItemDto,
  ) {
    const matter = await this.ensureMatter(user, matterId);
    this.assertMatterOpenForEditing(matter);
    const item = await this.prisma.checklistItem.findFirst({
      where: {
        id: checklistItemId,
        matterId,
        organizationId: user.organizationId,
      },
    });
    if (!item) throw new NotFoundException('Requisito no encontrado');
    if (item.status === ChecklistStatus.COMPLETE) {
      throw new BadRequestException('Un requisito completo no necesita dispensa');
    }

    await this.prisma.checklistItem.update({
      where: { id: item.id },
      data: {
        status: ChecklistStatus.WAIVED,
        completedAt: new Date(),
        waivedReason: dto.reason,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'CHECKLIST_ITEM_WAIVED',
      entityType: 'ChecklistItem',
      entityId: item.id,
      payload: { code: item.code, reason: dto.reason },
    });
    return this.get(user, matterId);
  }

  async refreshChecklist(user: AuthenticatedUser, matterId: string) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId },
      include: {
        parties: { select: { role: true } },
        leaseTerms: true,
        mediationTerms: true,
        documents: {
          select: {
            id: true,
            type: true,
            version: true,
            personId: true,
            propertyId: true,
            expiresAt: true,
            invalidatedAt: true,
            createdAt: true,
          },
        },
        checklistItems: true,
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');

    const mediation = matter.mediationTerms;
    const operationalDocuments = currentDocuments(matter.documents);
    const snapshot: ChecklistSnapshot = {
      hasProperty: Boolean(matter.propertyId),
      partyRoles: matter.parties.map(({ role }) => role),
      hasLeaseTerms: Boolean(matter.leaseTerms),
      hasLinkedLease: Boolean(matter.linkedMatterId),
      hasMediationData: Boolean(
        mediation?.agreementNumber && mediation.caseFileNumber && mediation.hearingAt && mediation.facilitatorName,
      ),
      documentTypes: operationalDocuments
        .filter(({ expiresAt }) => !expiresAt || expiresAt >= new Date())
        .map(({ type }) => type),
      hasGuaranteeProperty: Boolean(matter.guaranteePropertyId),
    };

    await this.prisma.$transaction(
      matter.checklistItems.map((item) => {
        if (
          item.status === ChecklistStatus.WAIVED
          || item.completionMode === RequirementCompletionMode.MANUAL
        ) return this.prisma.checklistItem.update({
          where: { id: item.id },
          data: {},
        });
        const complete = isChecklistItemComplete(item.code, snapshot);
        return this.prisma.checklistItem.update({
          where: { id: item.id },
          data: {
            status: complete ? ChecklistStatus.COMPLETE : ChecklistStatus.PENDING,
            completedAt: complete ? item.completedAt ?? new Date() : null,
          },
        });
      }),
    );
  }

  async setManualChecklistStatus(
    user: AuthenticatedUser,
    matterId: string,
    checklistItemId: string,
    status: 'PENDING' | 'COMPLETE',
  ) {
    const matter = await this.ensureMatter(user, matterId);
    this.assertMatterOpenForEditing(matter);
    const item = await this.prisma.checklistItem.findFirst({
      where: { id: checklistItemId, matterId, organizationId: user.organizationId },
    });
    if (!item) throw new NotFoundException('Requisito no encontrado');
    if (item.completionMode !== RequirementCompletionMode.MANUAL) {
      throw new BadRequestException('El requisito se valida automáticamente con los datos del expediente');
    }
    const nextStatus = status === 'COMPLETE' ? ChecklistStatus.COMPLETE : ChecklistStatus.PENDING;
    const updated = await this.prisma.checklistItem.update({
      where: { id: item.id },
      data: {
        status: nextStatus,
        completedAt: nextStatus === ChecklistStatus.COMPLETE ? new Date() : null,
        waivedReason: null,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'CHECKLIST_MANUAL_STATUS_CHANGED',
      entityType: 'ChecklistItem',
      entityId: item.id,
      payload: { code: item.code, from: item.status, to: updated.status },
    });
    return this.get(user, matterId);
  }

  private async ensureMatter(user: AuthenticatedUser, id: string) {
    const matter = await this.prisma.matter.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    return matter;
  }

  private assertMatterOpenForEditing(matter: { status: MatterStatus }) {
    if (FINISHED_STATUSES.has(matter.status)) {
      throw new BadRequestException('El expediente concluido es de sólo consulta');
    }
  }

  private async validateReferences(
    user: AuthenticatedUser,
    dto: Pick<CreateMatterDto | UpdateMatterDto, 'propertyId' | 'guaranteePropertyId' | 'linkedMatterId'>,
  ) {
    const propertyIds = [dto.propertyId, dto.guaranteePropertyId].filter(Boolean) as string[];
    if (propertyIds.length) {
      const count = await this.prisma.property.count({
        where: { id: { in: propertyIds }, organizationId: user.organizationId },
      });
      if (count !== new Set(propertyIds).size) throw new NotFoundException('Algún inmueble no pertenece a la organización');
    }
    if (dto.linkedMatterId) {
      const linked = await this.prisma.matter.findFirst({
        where: { id: dto.linkedMatterId, organizationId: user.organizationId },
      });
      if (!linked) throw new NotFoundException('El expediente relacionado no existe');
    }
  }

  private async ensureEligibleResponsible(organizationId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        organizationId,
        role: { in: [MembershipRole.ADMIN, MembershipRole.LAWYER, MembershipRole.OPERATOR] },
        user: { active: true },
      },
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
    if (!membership) {
      throw new BadRequestException('El responsable debe ser un integrante operativo activo de la organización');
    }
    return membership;
  }
}
