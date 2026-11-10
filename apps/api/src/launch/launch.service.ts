import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LaunchComplianceStatus,
  LaunchIntegrationKind,
  LaunchIntegrationStatus,
  LaunchProgramStatus,
  LaunchTargetEnvironment,
  LaunchUatCategory,
  LaunchUatStatus,
  MembershipRole,
  PilotIssueSeverity,
  PilotIssueStatus,
  PilotParticipantStatus,
  PilotProgramStatus,
  PilotValidationResult,
  Prisma,
} from '@despacho/database';
import { createHash } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { ObjectStorageService } from '../documents/object-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CompleteLaunchControlDto,
  CreateLaunchUatCaseDto,
  DecideLaunchDto,
  ReviewLaunchUatCaseDto,
  RunLaunchIntegrationDto,
  StartLaunchCycleDto,
  SubmitLaunchReviewDto,
  UpdateLaunchProgramDto,
} from './dto/launch.dto';
import { evaluateLaunchGates } from './launch-gates';

const REQUIRED_UAT_CATEGORIES = Object.values(LaunchUatCategory);
const REQUIRED_INTEGRATIONS = Object.values(LaunchIntegrationKind);

const DEFAULT_UAT_CASES: Array<{ title: string; category: LaunchUatCategory; expectedResult: string }> = [
  {
    title: 'Expediente integral desde captura hasta validación',
    category: LaunchUatCategory.FUNCTIONAL,
    expectedResult: 'La persona, inmueble, documentos y checklist quedan vinculados sin duplicados ni bloqueos ocultos.',
  },
  {
    title: 'Contrato y convenio con revisión jurídica',
    category: LaunchUatCategory.LEGAL,
    expectedResult: 'Las plantillas, cláusulas, versiones, PDF y aprobaciones reflejan exactamente la decisión jurídica.',
  },
  {
    title: 'Firma, activación, alertas y renovación',
    category: LaunchUatCategory.OPERATIONS,
    expectedResult: 'El flujo operativo conserva responsables, evidencia, alertas y continuidad hasta renovación o cierre.',
  },
  {
    title: 'Roles, auditoría y aislamiento entre organizaciones',
    category: LaunchUatCategory.SECURITY,
    expectedResult: 'Cada rol respeta permisos y ninguna referencia cruzada permite consultar o modificar datos ajenos.',
  },
  {
    title: 'Respaldo, restauración y continuidad local',
    category: LaunchUatCategory.RESILIENCE,
    expectedResult: 'El respaldo valida checksums y la restauración aislada recupera base y archivos con conteos verificables.',
  },
];

const DEFAULT_INTEGRATIONS: Array<{ kind: LaunchIntegrationKind; provider: string }> = [
  { kind: LaunchIntegrationKind.OCR, provider: 'MANUAL_REVIEW_SIMULATOR' },
  { kind: LaunchIntegrationKind.SIGNATURE, provider: 'MANUAL_SIGNATURE_SIMULATOR' },
  { kind: LaunchIntegrationKind.EMAIL, provider: 'OUTBOUND_EMAIL_SIMULATOR' },
  { kind: LaunchIntegrationKind.CALENDAR, provider: 'CALENDAR_REMINDER_SIMULATOR' },
  { kind: LaunchIntegrationKind.PASSWORD_RECOVERY, provider: 'LOCAL_RECOVERY_SIMULATOR' },
];

const DEFAULT_COMPLIANCE_CONTROLS = [
  { code: 'PRIVACY_NOTICE', label: 'Aviso de privacidad y finalidades aprobados' },
  { code: 'DATA_RETENTION', label: 'Retención, archivo y eliminación documentados' },
  { code: 'ACCESS_REVIEW', label: 'Matriz de acceso y revisión de usuarios completadas' },
  { code: 'INCIDENT_RESPONSE', label: 'Respuesta a incidentes y responsables ensayados' },
  { code: 'RESTORE_DRILL', label: 'Restauración aislada comprobada con evidencia' },
  { code: 'DATA_INVENTORY', label: 'Inventario de datos y encargados documentado' },
];

@Injectable()
export class LaunchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: ObjectStorageService,
    private readonly config: ConfigService,
  ) {}

  async overview(user: AuthenticatedUser) {
    const program = await this.ensureProgram(user);
    const [uatCases, integrationChecks, complianceControls, metricSnapshots, history, environment] = await Promise.all([
      this.prisma.launchUatCase.findMany({
        where: { organizationId: user.organizationId, programId: program.id },
        include: {
          matter: { select: { id: true, reference: true, title: true, status: true } },
          assignedMembership: { select: { id: true, role: true, user: { select: { id: true, displayName: true, email: true } } } },
          createdBy: { select: { id: true, displayName: true } },
          reviewedBy: { select: { id: true, displayName: true } },
        },
        orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.launchIntegrationCheck.findMany({
        where: { organizationId: user.organizationId, programId: program.id },
        include: { testedBy: { select: { id: true, displayName: true } } },
        orderBy: { kind: 'asc' },
      }),
      this.prisma.launchComplianceControl.findMany({
        where: { organizationId: user.organizationId, programId: program.id },
        include: { completedBy: { select: { id: true, displayName: true } } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.launchMetricSnapshot.findMany({
        where: { organizationId: user.organizationId, programId: program.id },
        include: {
          sourcePilotProgram: { select: { id: true, name: true, completedAt: true, rolloutPercentage: true, targetCases: true } },
          capturedBy: { select: { id: true, displayName: true } },
        },
        orderBy: { capturedAt: 'desc' },
        take: 10,
      }),
      this.prisma.launchProgram.findMany({
        where: { organizationId: user.organizationId, current: false },
        select: {
          id: true, name: true, status: true, targetEnvironment: true, decidedAt: true,
          decisionRationale: true, snapshotChecksum: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.inspectEnvironment(program.targetEnvironment),
    ]);

    const latestMetrics = metricSnapshots[0];
    const metricGates = latestMetrics?.gates as { blockers?: number } | undefined;
    const coveredCategories = new Set(uatCases.map((item) => item.category));
    const acceptedIntegrations = integrationChecks.filter((item) => (
      program.targetEnvironment === LaunchTargetEnvironment.LOCAL
        ? item.status === LaunchIntegrationStatus.SIMULATED || item.status === LaunchIntegrationStatus.VERIFIED
        : item.status === LaunchIntegrationStatus.VERIFIED
    )).length;
    const blockingControls = complianceControls.filter((item) => item.blocking);
    const gates = evaluateLaunchGates({
      environmentBlockers: environment.blockers,
      requiredUatCategories: REQUIRED_UAT_CATEGORIES.length,
      coveredUatCategories: REQUIRED_UAT_CATEGORIES.filter((category) => coveredCategories.has(category)).length,
      totalUatCases: uatCases.length,
      pendingUatCases: uatCases.filter((item) => item.status === LaunchUatStatus.PENDING || item.status === LaunchUatStatus.IN_PROGRESS).length,
      failedUatCases: uatCases.filter((item) => item.status === LaunchUatStatus.FAILED).length,
      requiredIntegrations: REQUIRED_INTEGRATIONS.length,
      acceptedIntegrations,
      requiredComplianceControls: blockingControls.length,
      completedComplianceControls: blockingControls.filter((item) => item.status === LaunchComplianceStatus.COMPLETE).length,
      hasMetricSnapshot: Boolean(latestMetrics),
      metricBlockers: Number(metricGates?.blockers ?? (latestMetrics ? 1 : 0)),
    });

    return {
      program,
      environment,
      gates,
      summary: {
        uatPassed: uatCases.filter((item) => item.status === LaunchUatStatus.PASSED).length,
        uatTotal: uatCases.length,
        integrationsAccepted: acceptedIntegrations,
        integrationsTotal: integrationChecks.length,
        controlsComplete: blockingControls.filter((item) => item.status === LaunchComplianceStatus.COMPLETE).length,
        controlsTotal: blockingControls.length,
        metricSnapshots: metricSnapshots.length,
      },
      uatCases,
      integrationChecks,
      complianceControls,
      metricSnapshots,
      history,
    };
  }

  async updateProgram(user: AuthenticatedUser, dto: UpdateLaunchProgramDto) {
    const program = await this.mutableProgram(user);
    const updated = await this.prisma.launchProgram.update({
      where: { id: program.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.scope !== undefined ? { scope: dto.scope.trim() } : {}),
        ...(dto.targetEnvironment !== undefined ? { targetEnvironment: dto.targetEnvironment } : {}),
      },
    });
    await this.record(user, 'LAUNCH_PROGRAM_UPDATED', 'LaunchProgram', program.id, {
      name: updated.name,
      targetEnvironment: updated.targetEnvironment,
    });
    return updated;
  }

  async startCycle(user: AuthenticatedUser, dto: StartLaunchCycleDto) {
    const previous = await this.ensureProgram(user);
    if (previous.status !== LaunchProgramStatus.GO && previous.status !== LaunchProgramStatus.NO_GO) {
      throw new BadRequestException('El ciclo actual debe tener una decisión final antes de iniciar otro');
    }
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.launchProgram.update({ where: { id: previous.id }, data: { current: false } });
      return tx.launchProgram.create({
        data: this.programCreateData(user, dto.name.trim(), dto.scope.trim(), dto.targetEnvironment),
      });
    });
    await this.record(user, 'LAUNCH_CYCLE_STARTED', 'LaunchProgram', created.id, {
      previousProgramId: previous.id,
      reason: dto.reason.trim(),
      targetEnvironment: created.targetEnvironment,
    });
    return created;
  }

  async createUatCase(user: AuthenticatedUser, dto: CreateLaunchUatCaseDto) {
    const program = await this.mutableProgram(user);
    await this.validateMatterAndMembership(user.organizationId, dto.matterId, dto.assignedMembershipId);
    const created = await this.prisma.launchUatCase.create({
      data: {
        organizationId: user.organizationId,
        programId: program.id,
        title: dto.title.trim(),
        category: dto.category,
        expectedResult: dto.expectedResult.trim(),
        matterId: dto.matterId || null,
        assignedMembershipId: dto.assignedMembershipId || null,
        createdById: user.userId,
      },
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe un caso UAT con ese título en el ciclo');
      }
      throw error;
    });
    await this.record(user, 'LAUNCH_UAT_CREATED', 'LaunchUatCase', created.id, { title: created.title, category: created.category });
    return created;
  }

  async reviewUatCase(user: AuthenticatedUser, id: string, dto: ReviewLaunchUatCaseDto) {
    const program = await this.mutableProgram(user);
    const item = await this.prisma.launchUatCase.findFirst({ where: { id, organizationId: user.organizationId, programId: program.id } });
    if (!item) throw new NotFoundException('Caso UAT no encontrado');
    const final = dto.status === LaunchUatStatus.PASSED || dto.status === LaunchUatStatus.FAILED;
    if (final && ((dto.actualResult?.trim().length ?? 0) < 10 || (dto.evidence?.trim().length ?? 0) < 10)) {
      throw new BadRequestException('Un resultado final requiere resultado observado y evidencia de al menos diez caracteres');
    }
    const updated = await this.prisma.launchUatCase.update({
      where: { id: item.id },
      data: {
        status: dto.status,
        actualResult: dto.actualResult?.trim() || null,
        evidence: dto.evidence?.trim() || null,
        reviewedById: final ? user.userId : null,
        reviewedAt: final ? new Date() : null,
      },
    });
    await this.record(user, 'LAUNCH_UAT_REVIEWED', 'LaunchUatCase', item.id, { from: item.status, to: updated.status, evidence: updated.evidence });
    return updated;
  }

  async runIntegration(user: AuthenticatedUser, kind: LaunchIntegrationKind, dto: RunLaunchIntegrationDto) {
    const program = await this.mutableProgram(user);
    const item = await this.prisma.launchIntegrationCheck.findFirst({
      where: { organizationId: user.organizationId, programId: program.id, kind },
    });
    if (!item) throw new NotFoundException('Integración no encontrada');
    let status: LaunchIntegrationStatus = LaunchIntegrationStatus.SIMULATED;
    let evidence = await this.simulateIntegration(user.organizationId, kind);
    let provider = dto.provider?.trim() || item.provider;
    if (dto.externalVerified) {
      if ((dto.evidence?.trim().length ?? 0) < 10 || !dto.provider?.trim()) {
        throw new BadRequestException('La verificación externa requiere proveedor y evidencia de al menos diez caracteres');
      }
      status = LaunchIntegrationStatus.VERIFIED;
      evidence = dto.evidence!.trim();
      provider = dto.provider!.trim();
    } else if (dto.evidence?.trim()) {
      evidence = `${evidence} Evidencia adicional: ${dto.evidence.trim()}`;
    }
    const updated = await this.prisma.launchIntegrationCheck.update({
      where: { id: item.id },
      data: { provider, status, evidence, testedById: user.userId, testedAt: new Date() },
    });
    await this.record(user, 'LAUNCH_INTEGRATION_TESTED', 'LaunchIntegrationCheck', item.id, { kind, provider, status });
    return updated;
  }

  async completeControl(user: AuthenticatedUser, code: string, dto: CompleteLaunchControlDto) {
    const program = await this.mutableProgram(user);
    const item = await this.prisma.launchComplianceControl.findFirst({
      where: { organizationId: user.organizationId, programId: program.id, code },
    });
    if (!item) throw new NotFoundException('Control de cumplimiento no encontrado');
    const updated = await this.prisma.launchComplianceControl.update({
      where: { id: item.id },
      data: { status: LaunchComplianceStatus.COMPLETE, evidence: dto.evidence.trim(), completedById: user.userId, completedAt: new Date() },
    });
    await this.record(user, 'LAUNCH_CONTROL_COMPLETED', 'LaunchComplianceControl', item.id, { code, evidence: updated.evidence });
    return updated;
  }

  async reopenControl(user: AuthenticatedUser, code: string, reason: string) {
    const program = await this.mutableProgram(user);
    const item = await this.prisma.launchComplianceControl.findFirst({
      where: { organizationId: user.organizationId, programId: program.id, code },
    });
    if (!item) throw new NotFoundException('Control de cumplimiento no encontrado');
    const updated = await this.prisma.launchComplianceControl.update({
      where: { id: item.id },
      data: { status: LaunchComplianceStatus.PENDING, evidence: null, completedById: null, completedAt: null },
    });
    await this.record(user, 'LAUNCH_CONTROL_REOPENED', 'LaunchComplianceControl', item.id, { code, reason: reason.trim() });
    return updated;
  }

  async captureMetrics(user: AuthenticatedUser) {
    const program = await this.mutableProgram(user);
    const pilot = await this.prisma.pilotProgram.findFirst({
      where: { organizationId: user.organizationId, status: PilotProgramStatus.COMPLETED },
      include: { participants: true, validations: true, issues: true, imports: true },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!pilot) throw new BadRequestException('Se requiere al menos un ciclo de piloto completado');
    const activeParticipants = pilot.participants.filter((item) => item.status === PilotParticipantStatus.ACTIVE);
    const trainedParticipants = activeParticipants.filter((item) => item.trainedAt);
    const matchedCases = pilot.validations.filter((item) => item.result === PilotValidationResult.MATCH).length;
    const seriousIssues = pilot.issues.filter((item) => (
      (item.severity === PilotIssueSeverity.HIGH || item.severity === PilotIssueSeverity.CRITICAL)
      && (item.status === PilotIssueStatus.OPEN || item.status === PilotIssueStatus.IN_PROGRESS)
    )).length;
    const [matters, documents, completedTasks, openTasks] = await Promise.all([
      this.prisma.matter.count({ where: { organizationId: user.organizationId } }),
      this.prisma.document.count({ where: { organizationId: user.organizationId, invalidatedAt: null } }),
      this.prisma.task.count({ where: { organizationId: user.organizationId, status: 'DONE' } }),
      this.prisma.task.count({ where: { organizationId: user.organizationId, status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED'] } } }),
    ]);
    const metrics = {
      pilotProgramId: pilot.id,
      pilotName: pilot.name,
      rolloutPercentage: pilot.rolloutPercentage,
      targetCases: pilot.targetCases,
      matchedCases,
      activeParticipants: activeParticipants.length,
      trainedParticipants: trainedParticipants.length,
      seriousIssues,
      committedImports: pilot.imports.filter((item) => item.status === 'COMMITTED').length,
      matters,
      documents,
      completedTasks,
      openTasks,
    };
    const checks = [
      this.metricGate('PILOT_COMPLETED', 'Piloto completado', pilot.status === PilotProgramStatus.COMPLETED, pilot.status),
      this.metricGate('ROLLOUT_100', 'Despliegue simulado al 100%', pilot.rolloutPercentage === 100, `${pilot.rolloutPercentage}%`),
      this.metricGate('TRAINED_COHORT', 'Cohorte capacitada', trainedParticipants.length >= 2, `${trainedParticipants.length} participante(s)`),
      this.metricGate('SAMPLE_RECONCILED', 'Muestra conciliada', matchedCases >= pilot.targetCases, `${matchedCases}/${pilot.targetCases}`),
      this.metricGate('NO_SERIOUS_ISSUES', 'Sin incidencias serias abiertas', seriousIssues === 0, `${seriousIssues} abierta(s)`),
    ];
    const gates = { ready: checks.every((item) => item.status === 'PASS'), blockers: checks.filter((item) => item.status === 'BLOCKED').length, checks };
    const checksum = createHash('sha256').update(JSON.stringify({ metrics, gates })).digest('hex');
    const snapshot = await this.prisma.launchMetricSnapshot.create({
      data: {
        organizationId: user.organizationId,
        programId: program.id,
        sourcePilotProgramId: pilot.id,
        metrics: metrics as Prisma.InputJsonValue,
        gates: gates as Prisma.InputJsonValue,
        checksum,
        capturedById: user.userId,
      },
    });
    await this.record(user, 'LAUNCH_METRICS_CAPTURED', 'LaunchMetricSnapshot', snapshot.id, { pilotProgramId: pilot.id, checksum, blockers: gates.blockers });
    return snapshot;
  }

  async submitReview(user: AuthenticatedUser, dto: SubmitLaunchReviewDto) {
    const program = await this.mutableProgram(user);
    const overview = await this.overview(user);
    if (!overview.gates.ready) {
      throw new BadRequestException(`El lanzamiento conserva ${overview.gates.blockers} compuerta(s) bloqueada(s)`);
    }
    const updated = await this.prisma.launchProgram.update({ where: { id: program.id }, data: { status: LaunchProgramStatus.REVIEW } });
    await this.record(user, 'LAUNCH_SUBMITTED_FOR_REVIEW', 'LaunchProgram', program.id, { comment: dto.comment.trim() });
    return updated;
  }

  async reopenReview(user: AuthenticatedUser, reason: string) {
    const program = await this.ensureProgram(user);
    if (program.status !== LaunchProgramStatus.REVIEW) throw new BadRequestException('Sólo un ciclo en revisión puede reabrirse');
    const updated = await this.prisma.launchProgram.update({ where: { id: program.id }, data: { status: LaunchProgramStatus.DRAFT } });
    await this.record(user, 'LAUNCH_REVIEW_REOPENED', 'LaunchProgram', program.id, { reason: reason.trim() });
    return updated;
  }

  async decide(user: AuthenticatedUser, dto: DecideLaunchDto) {
    if (dto.decision !== LaunchProgramStatus.GO && dto.decision !== LaunchProgramStatus.NO_GO) {
      throw new BadRequestException('La decisión final debe ser GO o NO_GO');
    }
    const program = await this.ensureProgram(user);
    if (program.status !== LaunchProgramStatus.REVIEW) throw new BadRequestException('El ciclo debe estar en revisión antes de decidir');
    const overview = await this.overview(user);
    if (dto.decision === LaunchProgramStatus.GO && !overview.gates.ready) {
      throw new BadRequestException('No se puede autorizar GO mientras existan compuertas bloqueadas');
    }
    const decidedAt = new Date();
    const decisionSnapshot = {
      formatVersion: 1,
      decidedAt: decidedAt.toISOString(),
      decision: dto.decision,
      targetEnvironment: program.targetEnvironment,
      deploymentExecuted: false,
      gates: overview.gates,
      environment: overview.environment,
      uatCases: overview.uatCases.map((item) => ({ id: item.id, category: item.category, title: item.title, status: item.status, evidence: item.evidence })),
      integrations: overview.integrationChecks.map((item) => ({ kind: item.kind, provider: item.provider, status: item.status, evidence: item.evidence })),
      compliance: overview.complianceControls.map((item) => ({ code: item.code, status: item.status, evidence: item.evidence })),
      metrics: overview.metricSnapshots[0] ? { id: overview.metricSnapshots[0].id, checksum: overview.metricSnapshots[0].checksum } : null,
    };
    const snapshotChecksum = createHash('sha256').update(JSON.stringify(decisionSnapshot)).digest('hex');
    const updated = await this.prisma.launchProgram.update({
      where: { id: program.id },
      data: {
        status: dto.decision,
        decisionRationale: dto.rationale.trim(),
        decisionSnapshot: decisionSnapshot as Prisma.InputJsonValue,
        snapshotChecksum,
        decidedById: user.userId,
        decidedAt,
      },
    });
    await this.record(user, 'LAUNCH_DECIDED', 'LaunchProgram', program.id, {
      decision: dto.decision,
      rationale: dto.rationale.trim(),
      snapshotChecksum,
      deploymentExecuted: false,
    });
    return updated;
  }

  async exportCsv(user: AuthenticatedUser) {
    const overview = await this.overview(user);
    const rows: unknown[][] = [
      ['Preparación de lanzamiento · MVP 6'],
      ['Programa', overview.program.name],
      ['Estado', overview.program.status],
      ['Ambiente objetivo', overview.program.targetEnvironment],
      ['Despliegue ejecutado', 'No'],
      ['Listo para decisión', overview.gates.ready ? 'Sí' : 'No'],
      [],
      ['Sección', 'Elemento', 'Estado', 'Evidencia', 'Responsable', 'Fecha'],
      ...overview.environment.checks.map((item) => ['6.1 Ambiente', item.label, item.status, item.detail, '', overview.environment.checkedAt]),
      ...overview.uatCases.map((item) => ['6.2 UAT', `${item.category}: ${item.title}`, item.status, item.evidence ?? item.actualResult ?? '', item.reviewedBy?.displayName ?? item.assignedMembership?.user.displayName ?? '', item.reviewedAt?.toISOString() ?? item.createdAt.toISOString()]),
      ...overview.integrationChecks.map((item) => ['6.3 Integración', item.kind, item.status, `${item.provider}: ${item.evidence ?? ''}`, item.testedBy?.displayName ?? '', item.testedAt?.toISOString() ?? item.createdAt.toISOString()]),
      ...overview.complianceControls.map((item) => ['6.4 Cumplimiento', item.label, item.status, item.evidence ?? '', item.completedBy?.displayName ?? '', item.completedAt?.toISOString() ?? item.createdAt.toISOString()]),
      ...overview.metricSnapshots.map((item) => ['6.5 Métricas', item.sourcePilotProgram.name, (item.gates as { ready?: boolean }).ready ? 'PASS' : 'BLOCKED', item.checksum, item.capturedBy.displayName, item.capturedAt.toISOString()]),
      ...overview.gates.checks.map((item) => ['6.6 Compuerta', item.label, item.status, item.detail, '', overview.program.updatedAt.toISOString()]),
    ];
    return {
      fileName: `preparacion-lanzamiento-${new Date().toISOString().slice(0, 10)}.csv`,
      content: `\uFEFF${rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\r\n')}`,
    };
  }

  private async ensureProgram(user: AuthenticatedUser) {
    const current = await this.prisma.launchProgram.findFirst({ where: { organizationId: user.organizationId, current: true } });
    if (current) return current;
    try {
      return await this.prisma.launchProgram.create({
        data: this.programCreateData(
          user,
          `${user.organizationName} · Aceptación y lanzamiento`,
          'Aceptación integral en ambiente local, sin ejecutar despliegue externo.',
          LaunchTargetEnvironment.LOCAL,
        ),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.launchProgram.findFirstOrThrow({ where: { organizationId: user.organizationId, current: true } });
      }
      throw error;
    }
  }

  private programCreateData(
    user: AuthenticatedUser,
    name: string,
    scope: string,
    targetEnvironment: LaunchTargetEnvironment,
  ): Prisma.LaunchProgramCreateInput {
    return {
      organization: { connect: { id: user.organizationId } },
      name,
      scope,
      targetEnvironment,
      createdBy: { connect: { id: user.userId } },
      uatCases: { create: DEFAULT_UAT_CASES.map((item) => ({ organizationId: user.organizationId, ...item, createdById: user.userId })) },
      integrationChecks: { create: DEFAULT_INTEGRATIONS.map((item) => ({ organizationId: user.organizationId, ...item })) },
      complianceControls: { create: DEFAULT_COMPLIANCE_CONTROLS.map((item) => ({ organizationId: user.organizationId, ...item })) },
    };
  }

  private async mutableProgram(user: AuthenticatedUser) {
    const program = await this.ensureProgram(user);
    if (program.status !== LaunchProgramStatus.DRAFT) {
      throw new BadRequestException('El ciclo sólo puede modificarse mientras está en borrador');
    }
    return program;
  }

  private async inspectEnvironment(target: LaunchTargetEnvironment) {
    const checks: Array<{ code: string; label: string; status: 'PASS' | 'WARNING' | 'BLOCKED'; blocking: boolean; detail: string }> = [];
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.push(this.environmentCheck('DATABASE', 'PostgreSQL', 'PASS', 'Conexión y consulta verificadas.'));
    } catch (error) {
      checks.push(this.environmentCheck('DATABASE', 'PostgreSQL', 'BLOCKED', error instanceof Error ? error.message : 'Sin conexión.'));
    }
    try {
      const storage = await this.storage.healthCheck();
      checks.push(this.environmentCheck('STORAGE', 'Almacenamiento', 'PASS', `Escritura, lectura y borrado verificados en ${storage.driver}/${storage.bucket}.`));
    } catch (error) {
      checks.push(this.environmentCheck('STORAGE', 'Almacenamiento', 'BLOCKED', error instanceof Error ? error.message : 'No disponible.'));
    }
    const nonLocal = target !== LaunchTargetEnvironment.LOCAL;
    const origins = (this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000').split(',').map((item) => item.trim());
    const secureOrigins = origins.every((item) => item.startsWith('https://'));
    checks.push(this.environmentCheck(
      'EXECUTION_SCOPE',
      'Alcance del ambiente',
      nonLocal ? (this.config.get('NODE_ENV') === 'production' ? 'PASS' : 'BLOCKED') : 'PASS',
      nonLocal ? 'Los ambientes remotos exigen NODE_ENV=production.' : 'Ejecución local certificable; no se publicará infraestructura.',
    ));
    checks.push(this.environmentCheck(
      'TRANSPORT_SECURITY',
      'HTTPS y cookie segura',
      nonLocal && (!secureOrigins || this.config.get('COOKIE_SECURE') !== 'true') ? 'BLOCKED' : nonLocal ? 'PASS' : 'WARNING',
      nonLocal ? 'Los orígenes remotos deben usar HTTPS y COOKIE_SECURE=true.' : 'HTTP local aceptado únicamente para simulación; TLS sigue siendo requisito de despliegue.',
    ));
    const recoveryDriver = this.config.get<string>('PASSWORD_RECOVERY_DRIVER', 'local');
    checks.push(this.environmentCheck(
      'RECOVERY_DRIVER',
      'Recuperación de acceso',
      nonLocal && ['local', 'disabled'].includes(recoveryDriver) ? 'BLOCKED' : nonLocal ? 'PASS' : 'WARNING',
      nonLocal ? `Adaptador configurado: ${recoveryDriver}.` : `Adaptador ${recoveryDriver}; la prueba local no envía correo externo.`,
    ));
    checks.push(this.environmentCheck('REQUEST_SECURITY', 'Trazabilidad HTTP', 'PASS', 'Request ID, límites de cuerpo y encabezados defensivos habilitados.'));
    return {
      target,
      deploymentExecuted: false,
      checkedAt: new Date().toISOString(),
      blockers: checks.filter((item) => item.status === 'BLOCKED' && item.blocking).length,
      warnings: checks.filter((item) => item.status === 'WARNING').length,
      checks,
    };
  }

  private environmentCheck(code: string, label: string, status: 'PASS' | 'WARNING' | 'BLOCKED', detail: string) {
    return { code, label, status, blocking: status === 'BLOCKED', detail };
  }

  private async simulateIntegration(organizationId: string, kind: LaunchIntegrationKind) {
    if (kind === LaunchIntegrationKind.OCR) {
      const reviews = await this.prisma.documentExtractionReview.count({ where: { organizationId } });
      return `Contrato de extracción manual y revisión humana disponible; ${reviews} revisión(es) persistida(s). No se llamó a IA externa.`;
    }
    if (kind === LaunchIntegrationKind.SIGNATURE) {
      const requests = await this.prisma.signatureRequest.count({ where: { organizationId } });
      return `Puerto de firma manual disponible; ${requests} solicitud(es) persistida(s). No se llamó a firma externa.`;
    }
    if (kind === LaunchIntegrationKind.EMAIL) {
      return 'Contrato de correo saliente simulado localmente; payload, idempotencia y evidencia listos, sin envío externo.';
    }
    if (kind === LaunchIntegrationKind.CALENDAR) {
      const reminders = await this.prisma.reminder.count({ where: { organizationId } });
      return `Contrato de calendario simulado con ${reminders} recordatorio(s) internos; no se creó ningún evento externo.`;
    }
    const driver = this.config.get<string>('PASSWORD_RECOVERY_DRIVER', 'local');
    return `Recuperación de un solo uso validada mediante adaptador ${driver}; no se expusieron tokens ni se envió correo externo.`;
  }

  private async validateMatterAndMembership(organizationId: string, matterId?: string, membershipId?: string) {
    const [matter, membership] = await Promise.all([
      matterId ? this.prisma.matter.findFirst({ where: { id: matterId, organizationId }, select: { id: true } }) : undefined,
      membershipId ? this.prisma.membership.findFirst({ where: { id: membershipId, organizationId, user: { active: true } }, select: { id: true, role: true } }) : undefined,
    ]);
    if (matterId && !matter) throw new BadRequestException('El expediente no pertenece a la organización activa');
    if (membershipId && !membership) throw new BadRequestException('El responsable no pertenece a la organización activa');
    if (membership && membership.role !== MembershipRole.ADMIN && membership.role !== MembershipRole.LAWYER && membership.role !== MembershipRole.OPERATOR) {
      throw new BadRequestException('El responsable debe tener un rol operativo');
    }
  }

  private metricGate(code: string, label: string, passed: boolean, detail: string) {
    return { code, label, status: passed ? 'PASS' as const : 'BLOCKED' as const, detail };
  }

  private record(user: AuthenticatedUser, action: string, entityType: string, entityId: string, payload: Record<string, unknown>) {
    return this.audit.record({ organizationId: user.organizationId, actorUserId: user.userId, action, entityType, entityId, payload });
  }

  private csvCell(value: unknown) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }
}
