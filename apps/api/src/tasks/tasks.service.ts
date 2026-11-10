import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MatterStatus, Prisma, TaskPriority, TaskSource, TaskStatus } from '@despacho/database';
import { currentDocuments } from '@despacho/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateTaskDto, TaskQueryDto, UpdateTaskDto } from './dto/task.dto';

const DAY_MS = 86_400_000;
const DOCUMENT_VALIDITY_TASK_PREFIX = 'document-validity:';
const CLOSED_STATUSES = new Set<TaskStatus>([TaskStatus.DONE, TaskStatus.CANCELLED]);
const FINISHED_MATTER_STATUSES = new Set<MatterStatus>([MatterStatus.CLOSED, MatterStatus.CANCELLED]);
const STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  IN_PROGRESS: [TaskStatus.BLOCKED, TaskStatus.DONE, TaskStatus.CANCELLED],
  BLOCKED: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.CANCELLED],
  DONE: [TaskStatus.TODO],
  CANCELLED: [TaskStatus.TODO],
};
const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

export function documentValidityTaskPlan(expiresAt: Date, asOf: Date) {
  const expiryDay = Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth(), expiresAt.getUTCDate());
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const daysRemaining = Math.round((expiryDay - asOfDay) / DAY_MS);
  if (daysRemaining > 30) return null;
  return {
    daysRemaining,
    priority: daysRemaining <= 15 ? TaskPriority.URGENT : TaskPriority.HIGH,
  };
}

export function isDocumentValidEvidence(expiresAt: Date | null, asOf: Date) {
  if (!expiresAt) return true;
  const expiryDay = Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth(), expiresAt.getUTCDate());
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return expiryDay >= asOfDay;
}

export function createsTaskDependencyCycle(
  dependencies: ReadonlyArray<{ taskId: string; dependsOnTaskId: string }>,
  taskId: string,
  dependsOnTaskId: string,
) {
  const dependencyMap = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const current = dependencyMap.get(dependency.taskId) ?? [];
    current.push(dependency.dependsOnTaskId);
    dependencyMap.set(dependency.taskId, current);
  }
  const pending = [dependsOnTaskId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const candidate = pending.pop()!;
    if (candidate === taskId) return true;
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    pending.push(...(dependencyMap.get(candidate) ?? []));
  }
  return false;
}

export function taskSlaEscalationPlan(
  dueAt: Date | null,
  status: TaskStatus,
  currentPriority: TaskPriority,
  asOf: Date,
) {
  if (!dueAt || CLOSED_STATUSES.has(status) || dueAt.getTime() >= asOf.getTime()) return null;
  const daysOverdue = Math.max(1, Math.ceil((asOf.getTime() - dueAt.getTime()) / DAY_MS));
  const level = daysOverdue >= 3 ? 2 : 1;
  const minimumPriority = level === 2 ? TaskPriority.URGENT : TaskPriority.HIGH;
  return {
    daysOverdue,
    level,
    priority: PRIORITY_WEIGHT[currentPriority] >= PRIORITY_WEIGHT[minimumPriority]
      ? currentPriority
      : minimumPriority,
  };
}

const taskInclude = {
  matter: { select: { id: true, reference: true, title: true, status: true } },
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
    orderBy: { createdAt: 'desc' as const },
    take: 10,
  },
  comments: {
    include: { author: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: 'desc' as const },
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
    orderBy: { linkedAt: 'desc' as const },
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
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.TaskInclude;

interface EnsureSystemTaskInput {
  organizationId: string;
  matterId: string;
  title: string;
  description?: string;
  dueAt?: Date;
  priority?: TaskPriority;
  assigneeMembershipId?: string | null;
  deduplicationKey: string;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, query: TaskQueryDto = {}, asOf = new Date()) {
    const q = query.q?.trim();
    const dueFilter = this.dueFilter(query.due, asOf);
    const where: Prisma.TaskWhereInput = {
      organizationId: user.organizationId,
      ...(q ? {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { matter: { reference: { contains: q, mode: 'insensitive' } } },
          { matter: { title: { contains: q, mode: 'insensitive' } } },
        ],
      } : {}),
      ...(query.matterId ? { matterId: query.matterId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assignee
        ? {
          assigneeMembershipId: query.assignee === 'mine'
            ? user.membershipId
            : query.assignee === 'unassigned' ? null : query.assignee,
        }
        : {}),
      ...(dueFilter ? { AND: [dueFilter] } : {}),
    };
    const tasks = await this.prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    });
    return tasks
      .map((task) => this.withTiming(task, asOf))
      .sort((left, right) => this.compareTasks(left, right));
  }

  async pendingSummary(
    user: AuthenticatedUser,
    query: { assignee?: string; q?: string } = {},
    asOf = new Date(),
  ) {
    const tasks = (await this.list(user, {
      q: query.q,
      assignee: query.assignee === 'all' ? undefined : query.assignee ?? 'mine',
    }, asOf)).filter((task) => !CLOSED_STATUSES.has(task.status));
    const group = (items: typeof tasks) => ({
      total: items.length,
      hasMore: items.length > 8,
      items: items.slice(0, 8).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt,
        matter: {
          id: task.matter.id,
          reference: task.matter.reference,
          title: task.matter.title,
        },
        assignee: task.assignee ? {
          id: task.assignee.id,
          displayName: task.assignee.user.displayName,
        } : null,
      })),
    });
    return {
      asOf: asOf.toISOString(),
      total: tasks.length,
      overdue: group(tasks.filter((task) => task.dueAt && new Date(task.dueAt) < asOf)),
      inTime: group(tasks.filter((task) => task.dueAt && new Date(task.dueAt) >= asOf)),
      noDueDate: group(tasks.filter((task) => !task.dueAt)),
    };
  }

  async dashboard(user: AuthenticatedUser, asOf = new Date()) {
    const tasks = await this.list(user, {}, asOf);
    const open = tasks.filter((task) => !CLOSED_STATUSES.has(task.status));
    const dueSoonLimit = new Date(asOf.getTime() + 7 * DAY_MS);
    const overdue = open.filter((task) => task.isOverdue);
    const dueSoon = open.filter((task) => task.dueAt
      && new Date(task.dueAt) >= asOf
      && new Date(task.dueAt) <= dueSoonLimit);
    const membershipMap = new Map<string, {
      membershipId: string | null;
      displayName: string;
      role?: string;
      open: number;
      overdue: number;
      blocked: number;
      urgent: number;
      escalated: number;
    }>();
    for (const task of open) {
      const key = task.assignee?.id ?? 'unassigned';
      const entry = membershipMap.get(key) ?? {
        membershipId: task.assignee?.id ?? null,
        displayName: task.assignee?.user.displayName ?? 'Sin responsable',
        role: task.assignee?.role,
        open: 0,
        overdue: 0,
        blocked: 0,
        urgent: 0,
        escalated: 0,
      };
      entry.open += 1;
      if (task.isOverdue) entry.overdue += 1;
      if (task.status === TaskStatus.BLOCKED) entry.blocked += 1;
      if (task.priority === TaskPriority.URGENT) entry.urgent += 1;
      if (task.isEscalated) entry.escalated += 1;
      membershipMap.set(key, entry);
    }
    return {
      asOf: asOf.toISOString(),
      metrics: {
        open: open.length,
        overdue: overdue.length,
        blocked: open.filter((task) => task.status === TaskStatus.BLOCKED).length,
        dueSoon: dueSoon.length,
        urgent: open.filter((task) => task.priority === TaskPriority.URGENT).length,
        escalated: open.filter((task) => task.isEscalated).length,
        mine: open.filter((task) => task.assignee?.id === user.membershipId).length,
      },
      workload: [...membershipMap.values()].sort((left, right) => right.open - left.open),
      priorityItems: [...overdue, ...dueSoon.filter((task) => !task.isOverdue)]
        .sort((left, right) => this.compareTasks(left, right)),
    };
  }

  async exportCsv(user: AuthenticatedUser, query: TaskQueryDto = {}, asOf = new Date()) {
    const tasks = await this.list(user, query, asOf);
    if (tasks.length > 10_000) {
      throw new BadRequestException('La exportación supera 10,000 tareas; aplica más filtros');
    }
    const rows: unknown[][] = [
      ['Referencia', 'Expediente', 'Tarea', 'Estado', 'Prioridad', 'Origen', 'Responsable', 'Fecha límite', 'Vencida', 'Días vencida', 'SLA', 'Bloqueo', 'Última nota'],
      ...tasks.map((task) => [
        task.matter.reference,
        task.matter.title,
        task.title,
        task.status,
        task.priority,
        task.source,
        task.assignee?.user.displayName ?? '',
        task.dueAt?.toISOString() ?? '',
        task.isOverdue ? 'Sí' : 'No',
        task.daysOverdue,
        task.slaEscalationLevel,
        task.blockedReason ?? '',
        task.comments[0]?.body ?? '',
      ]),
    ];
    return {
      fileName: `tareas-${asOf.toISOString().slice(0, 10)}.csv`,
      content: `\uFEFF${rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\r\n')}`,
    };
  }

  assignees(user: AuthenticatedUser) {
    return this.prisma.membership.findMany({
      where: { organizationId: user.organizationId, user: { active: true } },
      select: {
        id: true,
        role: true,
        user: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { user: { displayName: 'asc' } },
    });
  }

  async create(user: AuthenticatedUser, matterId: string, dto: CreateTaskDto) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId },
      select: { id: true, responsibleMembershipId: true, status: true },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (FINISHED_MATTER_STATUSES.has(matter.status)) {
      throw new BadRequestException('No se pueden crear tareas en un expediente concluido');
    }
    const assigneeMembershipId = dto.assigneeMembershipId ?? matter.responsibleMembershipId;
    if (assigneeMembershipId) await this.assertAssignee(user.organizationId, assigneeMembershipId);
    const task = await this.prisma.task.create({
      data: {
        organizationId: user.organizationId,
        matterId,
        title: dto.title.trim(),
        description: dto.description?.trim() || undefined,
        priority: dto.priority ?? TaskPriority.NORMAL,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        assigneeMembershipId,
        createdById: user.userId,
        requiresEvidence: dto.requiresEvidence ?? false,
      },
      include: taskInclude,
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'TASK_CREATED',
      entityType: 'Task',
      entityId: task.id,
      payload: {
        priority: task.priority,
        dueAt: task.dueAt?.toISOString(),
        assigneeMembershipId,
        requiresEvidence: task.requiresEvidence,
      },
    });
    await this.notifications.notifyTaskAssignment({
      organizationId: user.organizationId,
      matterId,
      taskId: task.id,
      taskTitle: task.title,
      assigneeMembershipId: task.assigneeMembershipId,
    }).catch(() => undefined);
    return this.withTiming(task, new Date());
  }

  async update(user: AuthenticatedUser, taskId: string, dto: UpdateTaskDto) {
    const current = await this.findOwned(user.organizationId, taskId);
    await this.assertMatterMutable(user.organizationId, current.matterId);
    if (dto.assigneeMembershipId) await this.assertAssignee(user.organizationId, dto.assigneeMembershipId);
    const data: Prisma.TaskUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.requiresEvidence !== undefined) data.requiresEvidence = dto.requiresEvidence;
    if (dto.assigneeMembershipId !== undefined) {
      data.assignee = dto.assigneeMembershipId
        ? { connect: { id: dto.assigneeMembershipId } }
        : { disconnect: true };
    }
    const task = await this.prisma.task.update({
      where: { id: current.id },
      data,
      include: taskInclude,
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: task.matterId,
      actorUserId: user.userId,
      action: 'TASK_UPDATED',
      entityType: 'Task',
      entityId: task.id,
      payload: { fields: Object.keys(dto) },
    });
    if (
      dto.assigneeMembershipId !== undefined
      && current.assigneeMembershipId !== task.assigneeMembershipId
    ) {
      await this.notifications.cancelTaskNotifications(user.organizationId, task.id).catch(() => undefined);
      await this.notifications.notifyTaskAssignment({
        organizationId: user.organizationId,
        matterId: task.matterId,
        taskId: task.id,
        taskTitle: task.title,
        assigneeMembershipId: task.assigneeMembershipId,
      }).catch(() => undefined);
      if (task.slaEscalationLevel > 0) {
        await this.notifications.notifyTaskEscalation({
          organizationId: user.organizationId,
          matterId: task.matterId,
          taskId: task.id,
          taskTitle: task.title,
          assigneeMembershipId: task.assigneeMembershipId,
          level: task.slaEscalationLevel,
          daysOverdue: this.withTiming(task, new Date()).daysOverdue,
        }).catch(() => undefined);
      }
    }
    return this.withTiming(task, new Date());
  }

  async reschedule(
    user: AuthenticatedUser,
    taskId: string,
    rawDueAt: string,
    rawReason: string,
  ) {
    const current = await this.findOwned(user.organizationId, taskId);
    await this.assertMatterMutable(user.organizationId, current.matterId);
    if (CLOSED_STATUSES.has(current.status)) {
      throw new BadRequestException('No se puede reprogramar una tarea concluida');
    }
    if (current.source === TaskSource.SYSTEM) {
      throw new BadRequestException('La fecha de una tarea automática pertenece a su regla de origen');
    }
    const dueAt = new Date(rawDueAt);
    const reason = rawReason.trim();
    if (current.dueAt?.getTime() === dueAt.getTime()) {
      throw new BadRequestException('La nueva fecha debe ser distinta de la fecha actual');
    }
    const task = await this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: current.id },
        data: {
          dueAt,
          slaEscalationLevel: 0,
          slaEscalatedAt: null,
        },
      });
      await tx.taskDueDateChange.create({
        data: {
          organizationId: user.organizationId,
          taskId: current.id,
          previousDueAt: current.dueAt,
          newDueAt: dueAt,
          reason,
          changedById: user.userId,
        },
      });
      return tx.task.findUniqueOrThrow({ where: { id: current.id }, include: taskInclude });
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: current.matterId,
      actorUserId: user.userId,
      action: 'TASK_DUE_DATE_CHANGED',
      entityType: 'Task',
      entityId: current.id,
      payload: {
        previousDueAt: current.dueAt?.toISOString() ?? null,
        newDueAt: dueAt.toISOString(),
        reason,
      },
    });
    await this.notifications.cancelTaskEscalationNotifications(
      user.organizationId,
      current.id,
    ).catch(() => undefined);
    return this.withTiming(task, new Date());
  }

  async addComment(user: AuthenticatedUser, taskId: string, rawBody: string) {
    const task = await this.findOwned(user.organizationId, taskId);
    await this.assertMatterMutable(user.organizationId, task.matterId);
    const comment = await this.prisma.taskComment.create({
      data: {
        organizationId: user.organizationId,
        taskId: task.id,
        body: rawBody.trim(),
        authorId: user.userId,
      },
      include: { author: { select: { id: true, displayName: true } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: task.matterId,
      actorUserId: user.userId,
      action: 'TASK_COMMENT_ADDED',
      entityType: 'Task',
      entityId: task.id,
      payload: { commentId: comment.id },
    });
    await this.notifications.notifyTaskComment({
      organizationId: user.organizationId,
      matterId: task.matterId,
      taskId: task.id,
      taskTitle: task.title,
      assigneeMembershipId: task.assigneeMembershipId,
      commentId: comment.id,
      commentBody: comment.body,
      authorUserId: user.userId,
      authorName: user.displayName,
    }).catch(() => undefined);
    return comment;
  }

  async addEvidence(user: AuthenticatedUser, taskId: string, documentId: string) {
    const task = await this.findOwned(user.organizationId, taskId);
    await this.assertMatterMutable(user.organizationId, task.matterId);
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
      select: { id: true, matterId: true, invalidatedAt: true, expiresAt: true },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    if (document.matterId !== task.matterId) {
      throw new BadRequestException('La evidencia debe pertenecer al mismo expediente que la tarea');
    }
    const operationalIds = await this.operationalDocumentIds(
      user.organizationId,
      task.matterId,
      new Date(),
    );
    if (!operationalIds.has(document.id)) {
      throw new BadRequestException('La evidencia debe ser una versión documental vigente y operativa');
    }
    const existing = await this.prisma.taskDocumentLink.findUnique({
      where: { taskId_documentId: { taskId: task.id, documentId: document.id } },
      select: { id: true },
    });
    if (!existing) {
      const link = await this.prisma.taskDocumentLink.create({
        data: {
          organizationId: user.organizationId,
          taskId: task.id,
          documentId: document.id,
          linkedById: user.userId,
        },
      });
      await this.audit.record({
        organizationId: user.organizationId,
        matterId: task.matterId,
        actorUserId: user.userId,
        action: 'TASK_EVIDENCE_LINKED',
        entityType: 'Task',
        entityId: task.id,
        payload: { linkId: link.id, documentId: document.id },
      });
    }
    const updated = await this.prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      include: taskInclude,
    });
    return this.withTiming(updated, new Date());
  }

  async addDependency(user: AuthenticatedUser, taskId: string, dependsOnTaskId: string) {
    const task = await this.findOwned(user.organizationId, taskId);
    await this.assertMatterMutable(user.organizationId, task.matterId);
    if (task.source !== TaskSource.MANUAL) {
      throw new BadRequestException('Las dependencias sólo pueden configurarse en tareas manuales');
    }
    if (task.status !== TaskStatus.TODO) {
      throw new BadRequestException('Los prerrequisitos sólo pueden modificarse antes de iniciar la tarea');
    }
    if (task.id === dependsOnTaskId) {
      throw new BadRequestException('Una tarea no puede depender de sí misma');
    }
    const dependsOnTask = await this.findOwned(user.organizationId, dependsOnTaskId);
    if (dependsOnTask.matterId !== task.matterId) {
      throw new BadRequestException('El prerrequisito debe pertenecer al mismo expediente');
    }
    if (dependsOnTask.source !== TaskSource.MANUAL) {
      throw new BadRequestException('Los prerrequisitos automáticos no se configuran manualmente');
    }
    if (dependsOnTask.status === TaskStatus.CANCELLED) {
      throw new BadRequestException('Una tarea cancelada no puede utilizarse como prerrequisito');
    }
    const dependencies = await this.prisma.taskDependency.findMany({
      where: { organizationId: user.organizationId, task: { matterId: task.matterId } },
      select: { taskId: true, dependsOnTaskId: true },
    });
    if (createsTaskDependencyCycle(dependencies, task.id, dependsOnTask.id)) {
      throw new BadRequestException('La dependencia produciría un ciclo entre tareas');
    }
    const existing = await this.prisma.taskDependency.findUnique({
      where: { taskId_dependsOnTaskId: { taskId: task.id, dependsOnTaskId: dependsOnTask.id } },
      select: { id: true },
    });
    if (!existing) {
      const dependency = await this.prisma.taskDependency.create({
        data: {
          organizationId: user.organizationId,
          taskId: task.id,
          dependsOnTaskId: dependsOnTask.id,
          createdById: user.userId,
        },
      });
      await this.audit.record({
        organizationId: user.organizationId,
        matterId: task.matterId,
        actorUserId: user.userId,
        action: 'TASK_DEPENDENCY_ADDED',
        entityType: 'Task',
        entityId: task.id,
        payload: { dependencyId: dependency.id, dependsOnTaskId: dependsOnTask.id },
      });
    }
    return this.taskWithDetails(task.id);
  }

  async removeDependency(user: AuthenticatedUser, taskId: string, dependencyId: string) {
    const task = await this.findOwned(user.organizationId, taskId);
    await this.assertMatterMutable(user.organizationId, task.matterId);
    if (task.source !== TaskSource.MANUAL || task.status !== TaskStatus.TODO) {
      throw new BadRequestException('Los prerrequisitos sólo pueden modificarse antes de iniciar la tarea');
    }
    const dependency = await this.prisma.taskDependency.findFirst({
      where: { id: dependencyId, taskId: task.id, organizationId: user.organizationId },
    });
    if (!dependency) throw new NotFoundException('Dependencia no encontrada');
    await this.prisma.taskDependency.delete({ where: { id: dependency.id } });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: task.matterId,
      actorUserId: user.userId,
      action: 'TASK_DEPENDENCY_REMOVED',
      entityType: 'Task',
      entityId: task.id,
      payload: { dependencyId: dependency.id, dependsOnTaskId: dependency.dependsOnTaskId },
    });
    return this.taskWithDetails(task.id);
  }

  async changeStatus(
    user: AuthenticatedUser,
    taskId: string,
    status: TaskStatus,
    rawReason?: string,
  ) {
    const current = await this.findOwned(user.organizationId, taskId);
    await this.assertMatterMutable(user.organizationId, current.matterId);
    if (current.status === status) {
      const task = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
      return this.withTiming(task, new Date());
    }
    if (
      current.deduplicationKey?.startsWith(DOCUMENT_VALIDITY_TASK_PREFIX)
      && (status === TaskStatus.DONE || status === TaskStatus.CANCELLED)
    ) {
      throw new BadRequestException(
        'Esta tarea se cierra automáticamente al renovar, corregir o invalidar el documento',
      );
    }
    if (!STATUS_TRANSITIONS[current.status].includes(status)) {
      throw new BadRequestException(`No se puede cambiar una tarea de ${current.status} a ${status}`);
    }
    if (status === TaskStatus.IN_PROGRESS || status === TaskStatus.DONE) {
      await this.assertPrerequisitesComplete(user.organizationId, current.id);
    }
    if (current.status === TaskStatus.DONE && status === TaskStatus.TODO) {
      await this.assertNoStartedDependents(user.organizationId, current.id);
    }
    const reason = rawReason?.trim();
    if (status === TaskStatus.BLOCKED && (!reason || reason.length < 10)) {
      throw new BadRequestException('Bloquear una tarea requiere un motivo de al menos 10 caracteres');
    }
    const completed = status === TaskStatus.DONE;
    if (
      completed
      && current.requiresEvidence
      && !(await this.hasValidTaskEvidence(user.organizationId, current.id, current.matterId, new Date()))
    ) {
      throw new BadRequestException(
        'La tarea exige al menos una evidencia documental vigente antes de completarse',
      );
    }
    const task = await this.prisma.task.update({
      where: { id: current.id },
      data: {
        status,
        completedAt: completed ? new Date() : null,
        completedById: completed ? user.userId : null,
        blockedReason: status === TaskStatus.BLOCKED ? reason : null,
        blockedAt: status === TaskStatus.BLOCKED ? new Date() : null,
        blockedById: status === TaskStatus.BLOCKED ? user.userId : null,
        ...(status === TaskStatus.TODO ? { slaEscalationLevel: 0, slaEscalatedAt: null } : {}),
      },
      include: taskInclude,
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: task.matterId,
      actorUserId: user.userId,
      action: 'TASK_STATUS_CHANGED',
      entityType: 'Task',
      entityId: task.id,
      payload: {
        from: current.status,
        to: status,
        ...(reason ? { reason } : {}),
        ...(current.status === TaskStatus.BLOCKED && current.blockedReason
          ? { resolvedBlockedReason: current.blockedReason }
          : {}),
      },
    });
    if (CLOSED_STATUSES.has(status)) {
      await this.notifications.cancelTaskNotifications(user.organizationId, task.id).catch(() => undefined);
    } else if (status === TaskStatus.TODO) {
      await this.notifications.notifyTaskAssignment({
        organizationId: user.organizationId,
        matterId: task.matterId,
        taskId: task.id,
        taskTitle: task.title,
        assigneeMembershipId: task.assigneeMembershipId,
      }).catch(() => undefined);
    }
    return this.withTiming(task, new Date());
  }

  async ensureSystemTask(input: EnsureSystemTaskInput) {
    const task = await this.prisma.task.upsert({
      where: {
        organizationId_deduplicationKey: {
          organizationId: input.organizationId,
          deduplicationKey: input.deduplicationKey,
        },
      },
      create: {
        organizationId: input.organizationId,
        matterId: input.matterId,
        title: input.title,
        description: input.description,
        source: TaskSource.SYSTEM,
        priority: input.priority ?? TaskPriority.HIGH,
        dueAt: input.dueAt,
        assigneeMembershipId: input.assigneeMembershipId,
        deduplicationKey: input.deduplicationKey,
      },
      update: {
        title: input.title,
        description: input.description,
        status: TaskStatus.TODO,
        priority: input.priority ?? TaskPriority.HIGH,
        dueAt: input.dueAt,
        assigneeMembershipId: input.assigneeMembershipId,
        completedAt: null,
        completedById: null,
        blockedReason: null,
        blockedAt: null,
        blockedById: null,
        slaEscalationLevel: 0,
        slaEscalatedAt: null,
      },
      include: taskInclude,
    });
    await this.audit.record({
      organizationId: input.organizationId,
      matterId: input.matterId,
      action: 'SYSTEM_TASK_SCHEDULED',
      entityType: 'Task',
      entityId: task.id,
      payload: { deduplicationKey: input.deduplicationKey, dueAt: input.dueAt?.toISOString() },
    });
    await this.notifications.notifyTaskAssignment({
      organizationId: input.organizationId,
      matterId: input.matterId,
      taskId: task.id,
      taskTitle: task.title,
      assigneeMembershipId: task.assigneeMembershipId,
    }).catch(() => undefined);
    return task;
  }

  syncDocumentValidityTasks(user: AuthenticatedUser, asOf = new Date()) {
    return this.syncDocumentValidityTasksForOrganization(user.organizationId, asOf, user.userId);
  }

  async syncSlaEscalations(user: AuthenticatedUser, asOf = new Date()) {
    const tasks = await this.prisma.task.findMany({
      where: {
        organizationId: user.organizationId,
        status: { notIn: [...CLOSED_STATUSES] },
        dueAt: { lt: asOf },
        matter: { status: { notIn: [...FINISHED_MATTER_STATUSES] } },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    });
    let escalated = 0;
    let advanced = 0;
    let reprioritized = 0;
    let unchanged = 0;

    for (const task of tasks) {
      const plan = taskSlaEscalationPlan(task.dueAt, task.status, task.priority, asOf);
      if (!plan) continue;
      const levelIncreased = plan.level > task.slaEscalationLevel;
      const priorityChanged = plan.priority !== task.priority;
      if (!levelIncreased && !priorityChanged) {
        unchanged += 1;
        continue;
      }
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          priority: plan.priority,
          slaEscalationLevel: Math.max(task.slaEscalationLevel, plan.level),
          slaEscalatedAt: asOf,
        },
      });
      if (levelIncreased) {
        escalated += 1;
        if (task.slaEscalationLevel > 0) advanced += 1;
      } else {
        reprioritized += 1;
      }
      await this.audit.record({
        organizationId: user.organizationId,
        matterId: task.matterId,
        actorUserId: user.userId,
        action: 'TASK_SLA_ESCALATED',
        entityType: 'Task',
        entityId: task.id,
        payload: {
          fromLevel: task.slaEscalationLevel,
          toLevel: Math.max(task.slaEscalationLevel, plan.level),
          daysOverdue: plan.daysOverdue,
          fromPriority: task.priority,
          toPriority: plan.priority,
        },
      });
      await this.notifications.notifyTaskEscalation({
        organizationId: user.organizationId,
        matterId: task.matterId,
        taskId: task.id,
        taskTitle: task.title,
        assigneeMembershipId: task.assigneeMembershipId,
        level: Math.max(task.slaEscalationLevel, plan.level),
        daysOverdue: plan.daysOverdue,
      }).catch(() => undefined);
    }

    return {
      asOf: asOf.toISOString(),
      eligible: tasks.length,
      escalated,
      advanced,
      reprioritized,
      unchanged,
    };
  }

  async syncDocumentValidityTasksForOrganization(
    organizationId: string,
    asOf = new Date(),
    actorUserId?: string,
    matterId?: string,
  ) {
    const asOfDay = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
    const windowEnd = new Date(asOfDay.getTime() + 31 * DAY_MS - 1);
    const documents = await this.prisma.document.findMany({
      where: { organizationId, matterId: matterId ?? { not: null } },
      select: {
        id: true,
        matterId: true,
        type: true,
        originalName: true,
        version: true,
        personId: true,
        propertyId: true,
        expiresAt: true,
        invalidatedAt: true,
        createdAt: true,
        matter: {
          select: {
            status: true,
            responsibleMembershipId: true,
          },
        },
      },
    });
    const operationalDocuments = currentDocuments(documents).filter((document) => (
      document.matter && !FINISHED_MATTER_STATUSES.has(document.matter.status)
    ));
    const desiredDocuments = operationalDocuments.filter((document) => (
      document.expiresAt
      && document.expiresAt <= windowEnd
      && documentValidityTaskPlan(document.expiresAt, asOfDay)
    ));
    const desiredKeys = new Set(
      desiredDocuments.map((document) => `${DOCUMENT_VALIDITY_TASK_PREFIX}${document.id}`),
    );
    const existingTasks = await this.prisma.task.findMany({
      where: {
        organizationId,
        ...(matterId ? { matterId } : {}),
        deduplicationKey: { startsWith: DOCUMENT_VALIDITY_TASK_PREFIX },
      },
    });
    const existingByKey = new Map(existingTasks.map((task) => [task.deduplicationKey!, task]));
    let created = 0;
    let updated = 0;
    let reopened = 0;
    let completed = 0;
    let cancelled = 0;

    for (const document of desiredDocuments) {
      const deduplicationKey = `${DOCUMENT_VALIDITY_TASK_PREFIX}${document.id}`;
      const existing = existingByKey.get(deduplicationKey);
      const plan = documentValidityTaskPlan(document.expiresAt!, asOfDay)!;
      const { daysRemaining, priority } = plan;
      const data = {
        title: `Renovar ${document.originalName}`,
        description: `Documento ${document.type} v${document.version}; vence ${document.expiresAt!.toISOString().slice(0, 10)}. La tarea se cerrará al incorporar una versión vigente.`,
        priority,
        dueAt: document.expiresAt,
        assigneeMembershipId: document.matter!.responsibleMembershipId,
      };
      if (!existing) {
        const task = await this.prisma.task.create({
          data: {
            organizationId,
            matterId: document.matterId!,
            source: TaskSource.SYSTEM,
            status: TaskStatus.TODO,
            deduplicationKey,
            ...data,
          },
        });
        created += 1;
        await this.audit.record({
          organizationId,
          matterId: document.matterId!,
          actorUserId,
          action: 'DOCUMENT_VALIDITY_TASK_CREATED',
          entityType: 'Task',
          entityId: task.id,
          payload: { documentId: document.id, daysRemaining, priority },
        });
        await this.notifications.notifyTaskAssignment({
          organizationId,
          matterId: document.matterId!,
          taskId: task.id,
          taskTitle: data.title,
          assigneeMembershipId: data.assigneeMembershipId,
        }).catch(() => undefined);
        continue;
      }
      const wasClosed = CLOSED_STATUSES.has(existing.status);
      await this.prisma.task.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(wasClosed ? {
            status: TaskStatus.TODO,
            completedAt: null,
            completedById: null,
            blockedReason: null,
            blockedAt: null,
            blockedById: null,
            slaEscalationLevel: 0,
            slaEscalatedAt: null,
          } : {}),
        },
      });
      updated += 1;
      if (wasClosed) {
        reopened += 1;
        await this.audit.record({
          organizationId,
          matterId: document.matterId!,
          actorUserId,
          action: 'DOCUMENT_VALIDITY_TASK_REOPENED',
          entityType: 'Task',
          entityId: existing.id,
          payload: { documentId: document.id, daysRemaining, priority },
        });
        await this.notifications.notifyTaskAssignment({
          organizationId,
          matterId: document.matterId!,
          taskId: existing.id,
          taskTitle: data.title,
          assigneeMembershipId: data.assigneeMembershipId,
        }).catch(() => undefined);
      }
    }

    const documentsById = new Map(documents.map((document) => [document.id, document]));
    const operationalIds = new Set(operationalDocuments.map((document) => document.id));
    for (const task of existingTasks) {
      if (!task.deduplicationKey || desiredKeys.has(task.deduplicationKey) || CLOSED_STATUSES.has(task.status)) {
        continue;
      }
      const documentId = task.deduplicationKey.slice(DOCUMENT_VALIDITY_TASK_PREFIX.length);
      const document = documentsById.get(documentId);
      const superseded = Boolean(document && !document.invalidatedAt && !operationalIds.has(document.id));
      const status = superseded ? TaskStatus.DONE : TaskStatus.CANCELLED;
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status,
          completedAt: status === TaskStatus.DONE ? new Date() : null,
          completedById: null,
          blockedReason: null,
          blockedAt: null,
          blockedById: null,
        },
      });
      if (status === TaskStatus.DONE) completed += 1;
      else cancelled += 1;
      await this.audit.record({
        organizationId,
        matterId: task.matterId,
        actorUserId,
        action: status === TaskStatus.DONE
          ? 'DOCUMENT_VALIDITY_TASK_COMPLETED'
          : 'DOCUMENT_VALIDITY_TASK_CANCELLED',
        entityType: 'Task',
        entityId: task.id,
        payload: { documentId, reason: superseded ? 'SUPERSEDED' : 'NO_LONGER_APPLICABLE' },
      });
      await this.notifications.cancelTaskNotifications(organizationId, task.id).catch(() => undefined);
    }

    return {
      asOf: asOfDay.toISOString(),
      windowDays: 30,
      eligible: desiredDocuments.length,
      created,
      updated,
      reopened,
      completed,
      cancelled,
    };
  }

  async completeSystemTask(organizationId: string, deduplicationKey: string, completedById: string) {
    const current = await this.prisma.task.findUnique({
      where: { organizationId_deduplicationKey: { organizationId, deduplicationKey } },
    });
    if (!current || CLOSED_STATUSES.has(current.status)) return current;
    const task = await this.prisma.task.update({
      where: { id: current.id },
      data: {
        status: TaskStatus.DONE,
        completedAt: new Date(),
        completedById,
        blockedReason: null,
        blockedAt: null,
        blockedById: null,
      },
    });
    await this.audit.record({
      organizationId,
      matterId: task.matterId,
      actorUserId: completedById,
      action: 'SYSTEM_TASK_COMPLETED',
      entityType: 'Task',
      entityId: task.id,
      payload: { deduplicationKey },
    });
    await this.notifications.cancelTaskNotifications(organizationId, task.id).catch(() => undefined);
    return task;
  }

  private findOwned(organizationId: string, taskId: string) {
    return this.prisma.task.findFirst({ where: { id: taskId, organizationId } }).then((task) => {
      if (!task) throw new NotFoundException('Tarea no encontrada');
      return task;
    });
  }

  private async assertAssignee(organizationId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId, user: { active: true } },
      select: { id: true },
    });
    if (!membership) throw new BadRequestException('El responsable no pertenece a la organización o está inactivo');
  }

  private async assertMatterMutable(organizationId: string, matterId: string) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId },
      select: { status: true },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (FINISHED_MATTER_STATUSES.has(matter.status)) {
      throw new BadRequestException('Las tareas de un expediente concluido son sólo de consulta');
    }
  }

  private async assertPrerequisitesComplete(organizationId: string, taskId: string) {
    const pending = await this.prisma.taskDependency.findMany({
      where: {
        organizationId,
        taskId,
        dependsOnTask: { status: { not: TaskStatus.DONE } },
      },
      select: { dependsOnTask: { select: { title: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (pending.length > 0) {
      throw new BadRequestException(
        `Completa primero los prerrequisitos: ${pending.map(({ dependsOnTask }) => dependsOnTask.title).join(', ')}`,
      );
    }
  }

  private async assertNoStartedDependents(organizationId: string, taskId: string) {
    const started = await this.prisma.taskDependency.findMany({
      where: {
        organizationId,
        dependsOnTaskId: taskId,
        task: { status: { notIn: [TaskStatus.TODO, TaskStatus.CANCELLED] } },
      },
      select: { task: { select: { title: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (started.length > 0) {
      throw new BadRequestException(
        `No se puede reabrir: ya habilitó tareas iniciadas o concluidas (${started.map(({ task }) => task.title).join(', ')})`,
      );
    }
  }

  private async taskWithDetails(taskId: string) {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: taskInclude,
    });
    return this.withTiming(task, new Date());
  }

  private async hasValidTaskEvidence(
    organizationId: string,
    taskId: string,
    matterId: string,
    asOf: Date,
  ) {
    const operationalIds = await this.operationalDocumentIds(organizationId, matterId, asOf);
    if (operationalIds.size === 0) return false;
    const link = await this.prisma.taskDocumentLink.findFirst({
      where: {
        organizationId,
        taskId,
        documentId: { in: [...operationalIds] },
      },
      select: { id: true },
    });
    return Boolean(link);
  }

  private async operationalDocumentIds(organizationId: string, matterId: string, asOf: Date) {
    const documents = await this.prisma.document.findMany({
      where: { organizationId, matterId },
      select: {
        id: true,
        matterId: true,
        type: true,
        version: true,
        personId: true,
        propertyId: true,
        expiresAt: true,
        invalidatedAt: true,
        createdAt: true,
      },
    });
    return new Set(
      currentDocuments(documents)
        .filter((document) => isDocumentValidEvidence(document.expiresAt, asOf))
        .map((document) => document.id),
    );
  }

  private withTiming<
    T extends { status: TaskStatus; dueAt: Date | null; slaEscalationLevel?: number },
  >(task: T, asOf: Date) {
    const isOpen = !CLOSED_STATUSES.has(task.status);
    const difference = task.dueAt ? task.dueAt.getTime() - asOf.getTime() : null;
    const isOverdue = Boolean(isOpen && difference !== null && difference < 0);
    return {
      ...task,
      isOverdue,
      isEscalated: Boolean(isOpen && (task.slaEscalationLevel ?? 0) > 0),
      daysRemaining: difference === null ? null : Math.ceil(difference / DAY_MS),
      daysOverdue: isOverdue ? Math.ceil(Math.abs(difference!) / DAY_MS) : 0,
    };
  }

  private compareTasks<
    T extends { status: TaskStatus; priority: TaskPriority; dueAt: Date | string | null; isOverdue: boolean },
  >(left: T, right: T) {
    const leftClosed = CLOSED_STATUSES.has(left.status) ? 1 : 0;
    const rightClosed = CLOSED_STATUSES.has(right.status) ? 1 : 0;
    if (leftClosed !== rightClosed) return leftClosed - rightClosed;
    if (left.isOverdue !== right.isOverdue) return left.isOverdue ? -1 : 1;
    const priority = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
    if (priority) return priority;
    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return leftDue - rightDue;
  }

  private dueFilter(due: TaskQueryDto['due'], asOf: Date): Prisma.TaskWhereInput | null {
    if (!due) return null;
    const open = { status: { notIn: [...CLOSED_STATUSES] } } satisfies Prisma.TaskWhereInput;
    if (due === 'OVERDUE') return { ...open, dueAt: { lt: asOf } };
    if (due === 'NO_DUE_DATE') return { ...open, dueAt: null };
    if (due === 'NEXT_7_DAYS') {
      return { ...open, dueAt: { gte: asOf, lte: new Date(asOf.getTime() + 7 * DAY_MS) } };
    }
    const start = new Date(asOf);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + DAY_MS - 1);
    return { ...open, dueAt: { gte: start, lte: end } };
  }

  private csvCell(value: unknown) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }
}
