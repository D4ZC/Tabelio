import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DocumentReviewDecision,
  DocumentType,
  MatterKind,
  MatterStatus,
  PortalSubmissionStatus,
  SignatureStatus,
  TaskStatus,
} from '@despacho/database';
import { renewalAlertFor } from '@despacho/domain';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { ReportQueryDto } from './dto/report-query.dto';

const DAY_MS = 86_400_000;
const CLOSED_MATTER_STATUSES = [MatterStatus.CLOSED, MatterStatus.CANCELLED];
const CLOSED_TASK_STATUSES = [TaskStatus.DONE, TaskStatus.CANCELLED];
const PIPELINE_ORDER: MatterStatus[] = [
  MatterStatus.DRAFT,
  MatterStatus.INTEGRATION,
  MatterStatus.PENDING_CLIENT,
  MatterStatus.VALIDATION,
  MatterStatus.READY_TO_DRAFT,
  MatterStatus.DRAFTING,
  MatterStatus.REVIEW,
  MatterStatus.APPROVAL,
  MatterStatus.SIGNATURE,
  MatterStatus.ACTIVE,
  MatterStatus.RENEWAL_DUE,
  MatterStatus.TERMINATION,
  MatterStatus.CLOSED,
  MatterStatus.CANCELLED,
];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async operations(user: AuthenticatedUser, query: ReportQueryDto) {
    const { from, to, asOf } = this.resolvePeriod(query);
    const period = { gte: from, lte: to };
    const staleBefore = new Date(asOf.getTime() - 7 * DAY_MS);

    const [
      pipelineGroups,
      mattersCreated,
      activatedMatters,
      documentsAdded,
      draftsGenerated,
      tasksCreated,
      completedTasks,
      openTasks,
      finalReviews,
      acceptedSubmissions,
      completedSignatures,
      completedTerminations,
      renewalMatters,
      staleMatters,
    ] = await Promise.all([
      this.prisma.matter.groupBy({
        by: ['status'],
        where: { organizationId: user.organizationId },
        _count: { _all: true },
      }),
      this.prisma.matter.findMany({
        where: { organizationId: user.organizationId, createdAt: period },
        select: { id: true, kind: true },
      }),
      this.prisma.matter.findMany({
        where: { organizationId: user.organizationId, activatedAt: period },
        select: { createdAt: true, activatedAt: true },
      }),
      this.prisma.document.count({
        where: { organizationId: user.organizationId, createdAt: period },
      }),
      this.prisma.document.count({
        where: {
          organizationId: user.organizationId,
          type: DocumentType.DRAFT_CONTRACT,
          createdAt: period,
        },
      }),
      this.prisma.task.count({
        where: { organizationId: user.organizationId, createdAt: period },
      }),
      this.prisma.task.findMany({
        where: { organizationId: user.organizationId, completedAt: period },
        select: { createdAt: true, dueAt: true, completedAt: true },
      }),
      this.prisma.task.findMany({
        where: {
          organizationId: user.organizationId,
          status: { notIn: CLOSED_TASK_STATUSES },
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueAt: true,
          blockedReason: true,
          blockedAt: true,
          assigneeMembershipId: true,
          matter: { select: { id: true, reference: true, title: true } },
          assignee: {
            select: { id: true, role: true, user: { select: { displayName: true } } },
          },
        },
      }),
      this.prisma.documentReview.findMany({
        where: {
          organizationId: user.organizationId,
          decision: DocumentReviewDecision.FINAL_APPROVED,
          createdAt: period,
        },
        select: { createdAt: true, document: { select: { createdAt: true } } },
      }),
      this.prisma.portalSubmission.count({
        where: {
          organizationId: user.organizationId,
          status: PortalSubmissionStatus.ACCEPTED,
          reviewedAt: period,
        },
      }),
      this.prisma.signatureRequest.count({
        where: {
          organizationId: user.organizationId,
          status: SignatureStatus.COMPLETED,
          completedAt: period,
        },
      }),
      this.prisma.auditEvent.count({
        where: {
          organizationId: user.organizationId,
          action: 'TERMINATION_COMPLETED_AND_MATTER_CLOSED',
          createdAt: period,
        },
      }),
      this.prisma.matter.findMany({
        where: {
          organizationId: user.organizationId,
          kind: MatterKind.LEASE,
          status: { in: [MatterStatus.ACTIVE, MatterStatus.RENEWAL_DUE] },
          leaseTerms: { isNot: null },
        },
        select: {
          id: true,
          reference: true,
          title: true,
          status: true,
          leaseTerms: { select: { endDate: true } },
          property: { select: { displayName: true } },
          responsible: { select: { user: { select: { displayName: true } } } },
        },
      }),
      this.prisma.matter.findMany({
        where: {
          organizationId: user.organizationId,
          status: { notIn: CLOSED_MATTER_STATUSES },
          updatedAt: { lt: staleBefore },
        },
        select: {
          id: true,
          reference: true,
          title: true,
          status: true,
          updatedAt: true,
          property: { select: { displayName: true } },
          responsible: { select: { user: { select: { displayName: true } } } },
          _count: {
            select: {
              checklistItems: { where: { blocking: true, status: 'PENDING' } },
              tasks: { where: { status: TaskStatus.BLOCKED } },
            },
          },
        },
        orderBy: { updatedAt: 'asc' },
        take: 25,
      }),
    ]);

    const dueCompletedTasks = completedTasks.filter((task) => task.dueAt && task.completedAt);
    const onTimeTasks = dueCompletedTasks.filter((task) => task.completedAt! <= task.dueAt!);
    const workload = new Map<string, {
      membershipId: string | null;
      displayName: string;
      role?: string;
      open: number;
      overdue: number;
      blocked: number;
      urgent: number;
    }>();
    for (const task of openTasks) {
      const key = task.assigneeMembershipId ?? 'unassigned';
      const row = workload.get(key) ?? {
        membershipId: task.assigneeMembershipId,
        displayName: task.assignee?.user.displayName ?? 'Sin responsable',
        role: task.assignee?.role,
        open: 0,
        overdue: 0,
        blocked: 0,
        urgent: 0,
      };
      row.open += 1;
      if (task.dueAt && task.dueAt < asOf) row.overdue += 1;
      if (task.status === TaskStatus.BLOCKED) row.blocked += 1;
      if (task.priority === 'URGENT') row.urgent += 1;
      workload.set(key, row);
    }

    const renewalRisk = renewalMatters
      .flatMap((matter) => {
        if (!matter.leaseTerms) return [];
        const renewal = renewalAlertFor(matter.leaseTerms.endDate, asOf);
        if (renewal.level === 'NONE') return [];
        return [{
          matterId: matter.id,
          reference: matter.reference,
          title: matter.title,
          status: matter.status,
          propertyName: matter.property?.displayName,
          responsibleName: matter.responsible?.user.displayName,
          ...renewal,
        }];
      })
      .sort((left, right) => left.daysRemaining - right.daysRemaining);
    const blockedTasks = openTasks
      .filter((task) => task.status === TaskStatus.BLOCKED && task.blockedAt && task.blockedReason)
      .map((task) => ({
        taskId: task.id,
        title: task.title,
        matterId: task.matter.id,
        reference: task.matter.reference,
        matterTitle: task.matter.title,
        responsibleName: task.assignee?.user.displayName,
        reason: task.blockedReason!,
        blockedAt: task.blockedAt!.toISOString(),
        daysBlocked: Math.max(0, Math.floor((asOf.getTime() - task.blockedAt!.getTime()) / DAY_MS)),
      }))
      .sort((left, right) => right.daysBlocked - left.daysBlocked)
      .slice(0, 25);
    const average = (values: number[]) => values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10
      : null;

    return {
      generatedAt: new Date().toISOString(),
      period: { from: from.toISOString(), to: to.toISOString(), asOf: asOf.toISOString() },
      summary: {
        mattersCreated: mattersCreated.length,
        leasesCreated: mattersCreated.filter((matter) => matter.kind === MatterKind.LEASE).length,
        agreementsCreated: mattersCreated.filter((matter) => matter.kind === MatterKind.MEDIATION_AGREEMENT).length,
        documentsAdded,
        draftsGenerated,
        finalApprovals: finalReviews.length,
        signaturesCompleted: completedSignatures,
        mattersActivated: activatedMatters.length,
        mattersClosed: completedTerminations,
        portalSubmissionsAccepted: acceptedSubmissions,
      },
      cycleTimes: {
        averageDaysToActivation: average(activatedMatters.map((matter) => (
          (matter.activatedAt!.getTime() - matter.createdAt.getTime()) / DAY_MS
        ))),
        averageDaysDraftToApproval: average(finalReviews.map((review) => (
          (review.createdAt.getTime() - review.document.createdAt.getTime()) / DAY_MS
        ))),
      },
      taskSla: {
        created: tasksCreated,
        completed: completedTasks.length,
        withDueDate: dueCompletedTasks.length,
        completedOnTime: onTimeTasks.length,
        compliancePercent: dueCompletedTasks.length
          ? Math.round(onTimeTasks.length / dueCompletedTasks.length * 1000) / 10
          : null,
        averageDaysToComplete: average(completedTasks.map((task) => (
          (task.completedAt!.getTime() - task.createdAt.getTime()) / DAY_MS
        ))),
        open: openTasks.length,
        overdue: openTasks.filter((task) => task.dueAt && task.dueAt < asOf).length,
        blocked: openTasks.filter((task) => task.status === TaskStatus.BLOCKED).length,
        blockedOver48Hours: blockedTasks.filter((task) => task.daysBlocked >= 2).length,
      },
      pipeline: PIPELINE_ORDER.map((status) => ({
        status,
        count: pipelineGroups.find((group) => group.status === status)?._count._all ?? 0,
      })),
      workload: [...workload.values()].sort((left, right) => right.open - left.open),
      renewalRisk: {
        total: renewalRisk.length,
        expired: renewalRisk.filter((item) => item.level === 'EXPIRED').length,
        due15: renewalRisk.filter((item) => item.level === 'DUE_15').length,
        due30: renewalRisk.filter((item) => item.level === 'DUE_30').length,
        due60: renewalRisk.filter((item) => item.level === 'DUE_60').length,
        due90: renewalRisk.filter((item) => item.level === 'DUE_90').length,
        items: renewalRisk,
      },
      bottlenecks: {
        staleAfterDays: 7,
        blockedTasks,
        staleMatters: staleMatters.map((matter) => ({
          matterId: matter.id,
          reference: matter.reference,
          title: matter.title,
          status: matter.status,
          updatedAt: matter.updatedAt.toISOString(),
          daysWithoutActivity: Math.floor((asOf.getTime() - matter.updatedAt.getTime()) / DAY_MS),
          propertyName: matter.property?.displayName,
          responsibleName: matter.responsible?.user.displayName,
          blockingChecklistItems: matter._count.checklistItems,
          blockedTasks: matter._count.tasks,
        })),
      },
    };
  }

  async operationsCsv(user: AuthenticatedUser, query: ReportQueryDto) {
    const report = await this.operations(user, query);
    const rows: unknown[][] = [
      ['Reporte operativo', 'Tabelio'],
      ['Periodo', `${report.period.from.slice(0, 10)} a ${report.period.to.slice(0, 10)}`],
      ['Corte', report.period.asOf],
      [],
      ['Resumen', 'Valor'],
      ['Expedientes creados', report.summary.mattersCreated],
      ['Arrendamientos creados', report.summary.leasesCreated],
      ['Convenios creados', report.summary.agreementsCreated],
      ['Documentos incorporados', report.summary.documentsAdded],
      ['Borradores generados', report.summary.draftsGenerated],
      ['Aprobaciones finales', report.summary.finalApprovals],
      ['Firmas completadas', report.summary.signaturesCompleted],
      ['Expedientes activados', report.summary.mattersActivated],
      ['Expedientes cerrados', report.summary.mattersClosed],
      ['Capturas de portal aceptadas', report.summary.portalSubmissionsAccepted],
      ['Promedio días a activación', report.cycleTimes.averageDaysToActivation ?? 'Sin datos'],
      ['Cumplimiento SLA de tareas', report.taskSla.compliancePercent === null ? 'Sin datos' : `${report.taskSla.compliancePercent}%`],
      [],
      ['Pipeline', 'Expedientes'],
      ...report.pipeline.map((item) => [item.status, item.count]),
      [],
      ['Carga por responsable', 'Abiertas', 'Vencidas', 'Bloqueadas', 'Urgentes'],
      ...report.workload.map((item) => [item.displayName, item.open, item.overdue, item.blocked, item.urgent]),
      [],
      ['Riesgo de renovación', 'Expediente', 'Vencimiento', 'Días restantes', 'Responsable'],
      ...report.renewalRisk.items.map((item) => [
        item.level,
        `${item.reference} · ${item.title}`,
        item.endDate.slice(0, 10),
        item.daysRemaining,
        item.responsibleName ?? 'Sin responsable',
      ]),
      [],
      ['Expedientes sin actividad', 'Estado', 'Días', 'Checklist bloqueante', 'Tareas bloqueadas'],
      ...report.bottlenecks.staleMatters.map((item) => [
        `${item.reference} · ${item.title}`,
        item.status,
        item.daysWithoutActivity,
        item.blockingChecklistItems,
        item.blockedTasks,
      ]),
      [],
      ['Tareas bloqueadas', 'Expediente', 'Responsable', 'Días bloqueada', 'Motivo'],
      ...report.bottlenecks.blockedTasks.map((item) => [
        item.title,
        `${item.reference} · ${item.matterTitle}`,
        item.responsibleName ?? 'Sin responsable',
        item.daysBlocked,
        item.reason,
      ]),
    ];
    return {
      fileName: `reporte-operativo-${report.period.from.slice(0, 10)}-${report.period.to.slice(0, 10)}.csv`,
      content: `\uFEFF${rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\r\n')}`,
    };
  }

  private resolvePeriod(query: ReportQueryDto) {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const to = query.to ? this.dateBoundary(query.to, 'end') : new Date(asOf);
    const from = query.from ? this.dateBoundary(query.from, 'start') : new Date(to.getTime() - 29 * DAY_MS);
    if (from > to) throw new BadRequestException('La fecha inicial no puede ser posterior a la final');
    if (to.getTime() - from.getTime() > 366 * DAY_MS) {
      throw new BadRequestException('El periodo máximo de un reporte es de 366 días');
    }
    return { from, to, asOf };
  }

  private dateBoundary(value: string, boundary: 'start' | 'end') {
    const date = new Date(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      if (boundary === 'start') date.setUTCHours(0, 0, 0, 0);
      else date.setUTCHours(23, 59, 59, 999);
    }
    return date;
  }

  private csvCell(value: unknown) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }
}
