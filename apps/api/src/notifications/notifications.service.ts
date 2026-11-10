import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MatterKind,
  MatterStatus,
  MembershipRole,
  Prisma,
  ReminderChannel,
  ReminderStatus,
  ReminderType,
} from '@despacho/database';
import { RENEWAL_ALERT_THRESHOLDS } from '@despacho/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

const TRACKED_MATTER_STATUSES: MatterStatus[] = [MatterStatus.ACTIVE, MatterStatus.RENEWAL_DUE];
const ACTIVE_REMINDER_STATUSES: ReminderStatus[] = [ReminderStatus.SCHEDULED, ReminderStatus.DUE];
const INBOX_REMINDER_TYPES: ReminderType[] = [
  ReminderType.MATTER_ASSIGNED,
  ReminderType.TASK_ASSIGNED,
  ReminderType.TASK_ESCALATED,
  ReminderType.TASK_COMMENTED,
];

interface InboxNotificationInput {
  organizationId: string;
  matterId: string;
  taskId?: string;
  recipientUserId: string;
  type: ReminderType;
  dedupeKey: string;
  payload: Prisma.InputJsonObject;
  scheduledFor?: Date;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async scheduleMatterReminders(organizationId: string, matterId: string, asOf = new Date()) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId },
      include: {
        leaseTerms: { select: { endDate: true } },
        responsible: { select: { userId: true } },
      },
    });
    if (
      !matter
      || matter.kind !== MatterKind.LEASE
      || !matter.leaseTerms
      || !TRACKED_MATTER_STATUSES.includes(matter.status)
    ) {
      await this.cancelMatterReminders(organizationId, matterId);
      return [];
    }

    const endDate = matter.leaseTerms.endDate;
    const dateKey = endDate.toISOString().slice(0, 10);
    const definitions = RENEWAL_ALERT_THRESHOLDS.map((thresholdDays) => {
      const scheduledFor = new Date(endDate);
      scheduledFor.setUTCDate(scheduledFor.getUTCDate() - thresholdDays);
      return {
        thresholdDays,
        scheduledFor,
        dedupeKey: `${organizationId}:renewal:${matterId}:${dateKey}:${thresholdDays}:in-app`,
      };
    });
    const activeKeys = definitions.map(({ dedupeKey }) => dedupeKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.reminder.updateMany({
        where: {
          organizationId,
          matterId,
          type: ReminderType.RENEWAL,
          channel: ReminderChannel.IN_APP,
          status: { in: ACTIVE_REMINDER_STATUSES },
          dedupeKey: { notIn: activeKeys },
        },
        data: { status: ReminderStatus.CANCELLED },
      });
      for (const definition of definitions) {
        const status = definition.scheduledFor <= asOf ? ReminderStatus.DUE : ReminderStatus.SCHEDULED;
        const payload = {
          reference: matter.reference,
          title: matter.title,
          endDate: endDate.toISOString(),
          thresholdDays: definition.thresholdDays,
        } satisfies Prisma.InputJsonObject;
        const existing = await tx.reminder.findUnique({
          where: { dedupeKey: definition.dedupeKey },
          select: { status: true },
        });
        await tx.reminder.upsert({
          where: { dedupeKey: definition.dedupeKey },
          create: {
            organizationId,
            matterId,
            recipientUserId: matter.responsible?.userId,
            type: ReminderType.RENEWAL,
            channel: ReminderChannel.IN_APP,
            thresholdDays: definition.thresholdDays,
            scheduledFor: definition.scheduledFor,
            status,
            dedupeKey: definition.dedupeKey,
            payload,
          },
          update: {
            recipientUserId: matter.responsible?.userId,
            scheduledFor: definition.scheduledFor,
            payload,
            ...(existing?.status === ReminderStatus.ACKNOWLEDGED ? {} : { status }),
          },
        });
      }
    });
    return this.prisma.reminder.findMany({
      where: { organizationId, matterId, dedupeKey: { in: activeKeys } },
      orderBy: { thresholdDays: 'desc' },
    });
  }

  async cancelMatterReminders(organizationId: string, matterId: string) {
    return this.prisma.reminder.updateMany({
      where: {
        organizationId,
        matterId,
        type: ReminderType.RENEWAL,
        status: { in: ACTIVE_REMINDER_STATUSES },
      },
      data: { status: ReminderStatus.CANCELLED },
    });
  }

  async syncOrganization(user: AuthenticatedUser) {
    const matters = await this.prisma.matter.findMany({
      where: {
        organizationId: user.organizationId,
        kind: MatterKind.LEASE,
        status: { in: TRACKED_MATTER_STATUSES },
      },
      select: { id: true },
    });
    for (const matter of matters) {
      await this.scheduleMatterReminders(user.organizationId, matter.id);
    }
    const cancelled = await this.prisma.reminder.updateMany({
      where: {
        organizationId: user.organizationId,
        type: ReminderType.RENEWAL,
        status: { in: ACTIVE_REMINDER_STATUSES },
        matter: { status: { notIn: TRACKED_MATTER_STATUSES } },
      },
      data: { status: ReminderStatus.CANCELLED },
    });
    return { matters: matters.length, scheduled: matters.length * RENEWAL_ALERT_THRESHOLDS.length, cancelled: cancelled.count };
  }

  async list(user: AuthenticatedUser, matterId?: string, asOf = new Date()) {
    await this.prisma.reminder.updateMany({
      where: {
        organizationId: user.organizationId,
        type: ReminderType.RENEWAL,
        status: ReminderStatus.SCHEDULED,
        scheduledFor: { lte: new Date() },
      },
      data: { status: ReminderStatus.DUE },
    });
    const reminders = await this.prisma.reminder.findMany({
      where: {
        organizationId: user.organizationId,
        type: ReminderType.RENEWAL,
        ...(matterId ? { matterId } : {}),
      },
      include: {
        matter: {
          select: {
            id: true,
            reference: true,
            title: true,
            status: true,
            property: { select: { id: true, displayName: true } },
          },
        },
        recipient: { select: { id: true, displayName: true, email: true } },
        acknowledgedBy: { select: { id: true, displayName: true } },
      },
      orderBy: [{ status: 'asc' }, { scheduledFor: 'asc' }],
    });
    return reminders.map((reminder) => ({
      ...reminder,
      effectiveStatus: reminder.status === ReminderStatus.SCHEDULED && reminder.scheduledFor <= asOf
        ? ReminderStatus.DUE
        : reminder.status,
    }));
  }

  async listInbox(user: AuthenticatedUser) {
    return this.prisma.reminder.findMany({
      where: {
        organizationId: user.organizationId,
        recipientUserId: user.userId,
        type: { in: INBOX_REMINDER_TYPES },
      },
      include: {
        matter: { select: { id: true, reference: true, title: true, status: true } },
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueAt: true,
            slaEscalationLevel: true,
          },
        },
        acknowledgedBy: { select: { id: true, displayName: true } },
      },
      orderBy: [{ status: 'asc' }, { scheduledFor: 'desc' }],
    });
  }

  async notifyMatterAssignment(input: {
    organizationId: string;
    matterId: string;
    recipientUserId: string;
    reference: string;
    title: string;
  }) {
    await this.prisma.reminder.updateMany({
      where: {
        organizationId: input.organizationId,
        matterId: input.matterId,
        type: ReminderType.MATTER_ASSIGNED,
        status: { in: ACTIVE_REMINDER_STATUSES },
        recipientUserId: { not: input.recipientUserId },
      },
      data: { status: ReminderStatus.CANCELLED },
    });
    return this.upsertInboxNotification({
      ...input,
      type: ReminderType.MATTER_ASSIGNED,
      dedupeKey: `${input.organizationId}:matter-assigned:${input.matterId}:${input.recipientUserId}`,
      payload: { reference: input.reference, title: input.title },
    });
  }

  async notifyTaskAssignment(input: {
    organizationId: string;
    matterId: string;
    taskId: string;
    taskTitle: string;
    assigneeMembershipId?: string | null;
  }) {
    if (!input.assigneeMembershipId) return null;
    const membership = await this.prisma.membership.findFirst({
      where: {
        id: input.assigneeMembershipId,
        organizationId: input.organizationId,
        user: { active: true },
      },
      select: { userId: true },
    });
    if (!membership) return null;
    await this.prisma.reminder.updateMany({
      where: {
        organizationId: input.organizationId,
        taskId: input.taskId,
        type: { in: [ReminderType.TASK_ASSIGNED, ReminderType.TASK_ESCALATED, ReminderType.TASK_COMMENTED] },
        status: { in: ACTIVE_REMINDER_STATUSES },
        recipientUserId: { not: membership.userId },
      },
      data: { status: ReminderStatus.CANCELLED },
    });
    return this.upsertInboxNotification({
      organizationId: input.organizationId,
      matterId: input.matterId,
      taskId: input.taskId,
      recipientUserId: membership.userId,
      type: ReminderType.TASK_ASSIGNED,
      dedupeKey: `${input.organizationId}:task-assigned:${input.taskId}:${membership.userId}`,
      payload: { taskTitle: input.taskTitle },
    });
  }

  async notifyTaskEscalation(input: {
    organizationId: string;
    matterId: string;
    taskId: string;
    taskTitle: string;
    assigneeMembershipId?: string | null;
    level: number;
    daysOverdue: number;
  }) {
    if (!input.assigneeMembershipId) return null;
    const membership = await this.prisma.membership.findFirst({
      where: {
        id: input.assigneeMembershipId,
        organizationId: input.organizationId,
        user: { active: true },
      },
      select: { userId: true },
    });
    if (!membership) return null;
    return this.upsertInboxNotification({
      organizationId: input.organizationId,
      matterId: input.matterId,
      taskId: input.taskId,
      recipientUserId: membership.userId,
      type: ReminderType.TASK_ESCALATED,
      dedupeKey: `${input.organizationId}:task-escalated:${input.taskId}:${input.level}:${membership.userId}`,
      payload: {
        taskTitle: input.taskTitle,
        level: input.level,
        daysOverdue: input.daysOverdue,
      },
    });
  }

  async notifyTaskComment(input: {
    organizationId: string;
    matterId: string;
    taskId: string;
    taskTitle: string;
    assigneeMembershipId?: string | null;
    commentId: string;
    commentBody: string;
    authorUserId: string;
    authorName: string;
  }) {
    if (!input.assigneeMembershipId) return null;
    const membership = await this.prisma.membership.findFirst({
      where: {
        id: input.assigneeMembershipId,
        organizationId: input.organizationId,
        user: { active: true },
      },
      select: { userId: true },
    });
    if (!membership || membership.userId === input.authorUserId) return null;
    return this.upsertInboxNotification({
      organizationId: input.organizationId,
      matterId: input.matterId,
      taskId: input.taskId,
      recipientUserId: membership.userId,
      type: ReminderType.TASK_COMMENTED,
      dedupeKey: `${input.organizationId}:task-commented:${input.commentId}:${membership.userId}`,
      payload: {
        taskTitle: input.taskTitle,
        commentId: input.commentId,
        commentBody: input.commentBody,
        authorName: input.authorName,
      },
    });
  }

  cancelTaskNotifications(organizationId: string, taskId: string) {
    return this.prisma.reminder.updateMany({
      where: {
        organizationId,
        taskId,
        type: { in: [ReminderType.TASK_ASSIGNED, ReminderType.TASK_ESCALATED, ReminderType.TASK_COMMENTED] },
        status: { in: ACTIVE_REMINDER_STATUSES },
      },
      data: { status: ReminderStatus.CANCELLED },
    });
  }

  cancelTaskEscalationNotifications(organizationId: string, taskId: string) {
    return this.prisma.reminder.updateMany({
      where: {
        organizationId,
        taskId,
        type: ReminderType.TASK_ESCALATED,
        status: { in: ACTIVE_REMINDER_STATUSES },
      },
      data: { status: ReminderStatus.CANCELLED },
    });
  }

  cancelMatterNotifications(organizationId: string, matterId: string) {
    return this.prisma.reminder.updateMany({
      where: {
        organizationId,
        matterId,
        status: { in: ACTIVE_REMINDER_STATUSES },
      },
      data: { status: ReminderStatus.CANCELLED },
    });
  }

  async acknowledge(user: AuthenticatedUser, reminderId: string) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id: reminderId, organizationId: user.organizationId },
    });
    if (!reminder) throw new NotFoundException('Recordatorio no encontrado');
    if (
      reminder.recipientUserId
      && reminder.recipientUserId !== user.userId
      && user.role !== MembershipRole.ADMIN
    ) {
      throw new ForbiddenException('Sólo el destinatario puede atender este aviso');
    }
    if (reminder.status === ReminderStatus.CANCELLED) {
      throw new NotFoundException('El recordatorio ya no está activo');
    }
    const acknowledged = await this.prisma.reminder.update({
      where: { id: reminder.id },
      data: {
        status: ReminderStatus.ACKNOWLEDGED,
        acknowledgedById: user.userId,
        acknowledgedAt: new Date(),
      },
      include: { acknowledgedBy: { select: { id: true, displayName: true } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: reminder.matterId,
      actorUserId: user.userId,
      action: 'REMINDER_ACKNOWLEDGED',
      entityType: 'Reminder',
      entityId: reminder.id,
      payload: { type: reminder.type, thresholdDays: reminder.thresholdDays, taskId: reminder.taskId },
    });
    return acknowledged;
  }

  private upsertInboxNotification(input: InboxNotificationInput) {
    const scheduledFor = input.scheduledFor ?? new Date();
    return this.prisma.reminder.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: {
        organizationId: input.organizationId,
        matterId: input.matterId,
        taskId: input.taskId,
        recipientUserId: input.recipientUserId,
        type: input.type,
        channel: ReminderChannel.IN_APP,
        scheduledFor,
        status: ReminderStatus.DUE,
        dedupeKey: input.dedupeKey,
        payload: input.payload,
      },
      update: {
        matterId: input.matterId,
        taskId: input.taskId,
        recipientUserId: input.recipientUserId,
        scheduledFor,
        status: ReminderStatus.DUE,
        payload: input.payload,
        acknowledgedById: null,
        acknowledgedAt: null,
      },
    });
  }
}
