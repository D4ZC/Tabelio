import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MembershipRole,
  PilotImportStatus,
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
import { PrismaService } from '../prisma/prisma.service';
import type {
  AddPilotParticipantDto,
  CancelPilotImportDto,
  ConfirmPilotTrainingDto,
  CreatePilotImportDto,
  CreatePilotIssueDto,
  CreatePilotValidationDto,
  PilotImportPersonDto,
  ReviewPilotValidationDto,
  StartPilotCycleDto,
  TransitionPilotProgramDto,
  UpdatePilotIssueDto,
  UpdatePilotProgramDto,
} from './dto/pilot-operations.dto';

const OPEN_ISSUE_STATUSES = [PilotIssueStatus.OPEN, PilotIssueStatus.IN_PROGRESS];
const ROLLOUT_STEPS = [10, 25, 50, 100];

@Injectable()
export class PilotOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview(user: AuthenticatedUser) {
    const program = await this.ensureProgram(user);
    const [participants, validations, issues, imports, gates, history] = await Promise.all([
      this.prisma.pilotParticipant.findMany({
        where: { organizationId: user.organizationId, programId: program.id },
        include: {
          membership: {
            select: {
              id: true,
              role: true,
              user: { select: { id: true, displayName: true, email: true, active: true } },
            },
          },
          trainedBy: { select: { id: true, displayName: true } },
          addedBy: { select: { id: true, displayName: true } },
        },
        orderBy: [{ status: 'asc' }, { addedAt: 'asc' }],
      }),
      this.prisma.pilotValidation.findMany({
        where: { organizationId: user.organizationId, programId: program.id },
        include: {
          matter: { select: { id: true, reference: true, title: true, kind: true, status: true } },
          validatedBy: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.pilotIssue.findMany({
        where: { organizationId: user.organizationId, programId: program.id },
        include: {
          matter: { select: { id: true, reference: true, title: true } },
          assignedMembership: {
            select: { id: true, role: true, user: { select: { id: true, displayName: true } } },
          },
          reportedBy: { select: { id: true, displayName: true } },
          resolvedBy: { select: { id: true, displayName: true } },
        },
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { reportedAt: 'desc' }],
      }),
      this.prisma.pilotImportBatch.findMany({
        where: { organizationId: user.organizationId, programId: program.id },
        select: {
          id: true,
          sourceName: true,
          checksum: true,
          status: true,
          totalRows: true,
          validRows: true,
          invalidRows: true,
          importedRows: true,
          validation: true,
          createdAt: true,
          committedAt: true,
          createdBy: { select: { id: true, displayName: true } },
          committedBy: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      this.gates(user, program),
      this.prisma.pilotProgram.findMany({
        where: { organizationId: user.organizationId, current: false },
        select: {
          id: true,
          name: true,
          status: true,
          rolloutPercentage: true,
          targetCases: true,
          startsAt: true,
          completedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return { program, gates, participants, validations, issues, imports, history };
  }

  async gates(user: AuthenticatedUser, knownProgram?: Awaited<ReturnType<PilotOperationsService['ensureProgram']>>) {
    const program = knownProgram ?? await this.ensureProgram(user);
    const [activeParticipants, untrainedParticipants, matchedValidations, pendingValidations, mismatches, committedImports, seriousIssues] = await Promise.all([
      this.prisma.pilotParticipant.count({
        where: { organizationId: user.organizationId, programId: program.id, status: PilotParticipantStatus.ACTIVE },
      }),
      this.prisma.pilotParticipant.count({
        where: {
          organizationId: user.organizationId,
          programId: program.id,
          status: PilotParticipantStatus.ACTIVE,
          trainedAt: null,
        },
      }),
      this.prisma.pilotValidation.count({
        where: { organizationId: user.organizationId, programId: program.id, result: PilotValidationResult.MATCH },
      }),
      this.prisma.pilotValidation.count({
        where: { organizationId: user.organizationId, programId: program.id, result: PilotValidationResult.PENDING },
      }),
      this.prisma.pilotValidation.count({
        where: { organizationId: user.organizationId, programId: program.id, result: PilotValidationResult.MISMATCH },
      }),
      this.prisma.pilotImportBatch.count({
        where: { organizationId: user.organizationId, programId: program.id, status: PilotImportStatus.COMMITTED },
      }),
      this.prisma.pilotIssue.count({
        where: {
          organizationId: user.organizationId,
          programId: program.id,
          status: { in: OPEN_ISSUE_STATUSES },
          severity: { in: [PilotIssueSeverity.HIGH, PilotIssueSeverity.CRITICAL] },
        },
      }),
    ]);
    const gates = [
      this.gate('CONTROLLED_MIGRATION', 'Migración controlada', committedImports > 0,
        committedImports > 0 ? `${committedImports} lote(s) importado(s) con vista previa.` : 'Falta confirmar al menos un lote de migración validado.', committedImports),
      this.gate('PILOT_COHORT', 'Cohorte reducida', activeParticipants >= 2,
        activeParticipants >= 2 ? `${activeParticipants} participantes activos.` : 'Se requieren al menos dos participantes activos.', activeParticipants),
      this.gate('TRAINING_COMPLETE', 'Capacitación', activeParticipants >= 2 && untrainedParticipants === 0,
        untrainedParticipants === 0 && activeParticipants >= 2 ? 'Toda la cohorte activa tiene evidencia de capacitación.' : `${untrainedParticipants} participante(s) sin capacitación confirmada.`, untrainedParticipants),
      this.gate('PARALLEL_OPERATION', 'Operación paralela', matchedValidations >= program.targetCases && pendingValidations === 0 && mismatches === 0,
        `${matchedValidations}/${program.targetCases} casos conciliados; ${pendingValidations} pendiente(s), ${mismatches} diferencia(s).`, matchedValidations),
      this.gate('SERIOUS_ISSUES', 'Correcciones críticas', seriousIssues === 0,
        seriousIssues === 0 ? 'No hay incidencias altas o críticas abiertas.' : `${seriousIssues} incidencia(s) alta(s) o crítica(s) siguen abiertas.`, seriousIssues),
    ];
    return {
      ready: gates.every((item) => item.status === 'PASS'),
      blockers: gates.filter((item) => item.status === 'BLOCKED').length,
      checks: gates,
      counts: {
        activeParticipants,
        untrainedParticipants,
        matchedValidations,
        pendingValidations,
        mismatches,
        committedImports,
        seriousIssues,
      },
    };
  }

  async updateProgram(user: AuthenticatedUser, dto: UpdatePilotProgramDto) {
    const program = await this.ensureProgram(user);
    if (dto.targetCases !== undefined && ([PilotProgramStatus.ACTIVE, PilotProgramStatus.PAUSED, PilotProgramStatus.COMPLETED] as PilotProgramStatus[]).includes(program.status)) {
      throw new BadRequestException('La muestra objetivo no puede cambiar después de iniciar el piloto');
    }
    const updated = await this.prisma.pilotProgram.update({
      where: { id: program.id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.targetCases === undefined ? {} : { targetCases: dto.targetCases }),
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_PROGRAM_UPDATED',
      entityType: 'PilotProgram',
      entityId: program.id,
      payload: { name: updated.name, targetCases: updated.targetCases },
    });
    return updated;
  }

  async transitionProgram(user: AuthenticatedUser, dto: TransitionPilotProgramDto) {
    const program = await this.ensureProgram(user);
    const gates = await this.gates(user, program);
    const target = dto.status;
    let rolloutPercentage = program.rolloutPercentage;
    if (target === PilotProgramStatus.READY) {
      if (program.status !== PilotProgramStatus.DRAFT) throw new BadRequestException('Sólo un programa en borrador puede marcarse listo');
      if (!gates.ready) throw new BadRequestException(`Faltan ${gates.blockers} compuertas operativas para preparar el piloto`);
    } else if (target === PilotProgramStatus.ACTIVE) {
      if (!([PilotProgramStatus.READY, PilotProgramStatus.ACTIVE, PilotProgramStatus.PAUSED] as PilotProgramStatus[]).includes(program.status)) {
        throw new BadRequestException('El programa no puede activarse desde su estado actual');
      }
      if (!gates.ready) throw new BadRequestException(`Faltan ${gates.blockers} compuertas operativas para activar el piloto`);
      rolloutPercentage = dto.rolloutPercentage ?? (program.rolloutPercentage || 10);
      if (!ROLLOUT_STEPS.includes(rolloutPercentage)) {
        throw new BadRequestException('El despliegue debe avanzar por 10, 25, 50 o 100 por ciento');
      }
      if (program.status === PilotProgramStatus.READY && rolloutPercentage !== 10) {
        throw new BadRequestException('El primer despliegue debe iniciar en 10 por ciento');
      }
      if (program.status === PilotProgramStatus.PAUSED && rolloutPercentage !== program.rolloutPercentage) {
        throw new BadRequestException('Reanuda el piloto en el mismo porcentaje antes de ampliarlo');
      }
      if (program.status === PilotProgramStatus.ACTIVE && rolloutPercentage !== program.rolloutPercentage) {
        const currentIndex = ROLLOUT_STEPS.indexOf(program.rolloutPercentage);
        if (rolloutPercentage !== ROLLOUT_STEPS[currentIndex + 1]) {
          throw new BadRequestException('El despliegue debe avanzar al siguiente porcentaje configurado');
        }
      }
    } else if (target === PilotProgramStatus.PAUSED) {
      if (program.status !== PilotProgramStatus.ACTIVE) throw new BadRequestException('Sólo un piloto activo puede pausarse');
    } else if (target === PilotProgramStatus.COMPLETED) {
      if (!([PilotProgramStatus.ACTIVE, PilotProgramStatus.PAUSED] as PilotProgramStatus[]).includes(program.status)) {
        throw new BadRequestException('Sólo un piloto iniciado puede completarse');
      }
      if (!gates.ready) throw new BadRequestException(`Faltan ${gates.blockers} compuertas operativas para cerrar el piloto`);
      if (program.rolloutPercentage !== 100) throw new BadRequestException('El despliegue debe alcanzar 100 por ciento antes del cierre');
      rolloutPercentage = 100;
    } else if (target === PilotProgramStatus.DRAFT) {
      if (program.status !== PilotProgramStatus.READY) throw new BadRequestException('Sólo un programa listo puede regresar a borrador');
      rolloutPercentage = 0;
    } else {
      throw new BadRequestException('Transición de piloto no permitida');
    }
    const now = new Date();
    const updated = await this.prisma.pilotProgram.update({
      where: { id: program.id },
      data: {
        status: target,
        rolloutPercentage,
        ...(target === PilotProgramStatus.ACTIVE && !program.startsAt ? { startsAt: now } : {}),
        ...(target === PilotProgramStatus.COMPLETED ? { completedAt: now } : {}),
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_PROGRAM_TRANSITIONED',
      entityType: 'PilotProgram',
      entityId: program.id,
      payload: { from: program.status, to: target, rolloutPercentage, comment: dto.comment.trim() },
    });
    return updated;
  }

  async startCycle(user: AuthenticatedUser, dto: StartPilotCycleDto) {
    const previous = await this.ensureProgram(user);
    if (previous.status !== PilotProgramStatus.COMPLETED) {
      throw new BadRequestException('El ciclo actual debe completarse antes de iniciar uno nuevo');
    }
    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.pilotProgram.update({
          where: { id: previous.id },
          data: { current: false },
        });
        return tx.pilotProgram.create({
          data: {
            organizationId: user.organizationId,
            name: dto.name.trim(),
            targetCases: dto.targetCases,
            current: true,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe un nuevo ciclo actual para la organización');
      }
      throw error;
    }
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_CYCLE_STARTED',
      entityType: 'PilotProgram',
      entityId: created.id,
      payload: {
        previousProgramId: previous.id,
        name: created.name,
        targetCases: created.targetCases,
        reason: dto.reason.trim(),
      },
    });
    return created;
  }

  async addParticipant(user: AuthenticatedUser, dto: AddPilotParticipantDto) {
    const program = await this.ensureProgram(user);
    if (program.status === PilotProgramStatus.COMPLETED) throw new BadRequestException('El piloto ya está cerrado');
    const membership = await this.prisma.membership.findFirst({
      where: {
        id: dto.membershipId,
        organizationId: user.organizationId,
        role: { in: [MembershipRole.ADMIN, MembershipRole.LAWYER, MembershipRole.OPERATOR] },
        user: { active: true },
      },
    });
    if (!membership) throw new BadRequestException('Selecciona una membresía activa con función operativa');
    const participant = await this.prisma.pilotParticipant.upsert({
      where: { programId_membershipId: { programId: program.id, membershipId: membership.id } },
      create: {
        organizationId: user.organizationId,
        programId: program.id,
        membershipId: membership.id,
        addedById: user.userId,
      },
      update: { status: PilotParticipantStatus.ACTIVE, removedAt: null },
      include: { membership: { include: { user: { select: { id: true, displayName: true, email: true } } } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_PARTICIPANT_ADDED',
      entityType: 'PilotParticipant',
      entityId: participant.id,
      payload: { membershipId: membership.id },
    });
    return participant;
  }

  async removeParticipant(user: AuthenticatedUser, participantId: string, reason: string) {
    const program = await this.ensureProgram(user);
    if (program.status === PilotProgramStatus.COMPLETED) throw new BadRequestException('El piloto ya está cerrado');
    const participant = await this.participant(user.organizationId, program.id, participantId);
    if (participant.status === PilotParticipantStatus.REMOVED) return participant;
    if (([PilotProgramStatus.ACTIVE, PilotProgramStatus.PAUSED] as PilotProgramStatus[]).includes(program.status)) {
      const remaining = await this.prisma.pilotParticipant.count({
        where: { programId: program.id, status: PilotParticipantStatus.ACTIVE, id: { not: participant.id } },
      });
      if (remaining < 2) throw new BadRequestException('El piloto activo debe conservar al menos dos participantes');
    }
    if (reason.trim().length < 10) throw new BadRequestException('El motivo debe tener al menos 10 caracteres');
    const updated = await this.prisma.pilotParticipant.update({
      where: { id: participant.id },
      data: { status: PilotParticipantStatus.REMOVED, removedAt: new Date() },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_PARTICIPANT_REMOVED',
      entityType: 'PilotParticipant',
      entityId: participant.id,
      payload: { reason: reason.trim() },
    });
    return updated;
  }

  async confirmTraining(user: AuthenticatedUser, participantId: string, dto: ConfirmPilotTrainingDto) {
    const program = await this.ensureProgram(user);
    if (program.status === PilotProgramStatus.COMPLETED) throw new BadRequestException('El piloto ya está cerrado');
    const participant = await this.participant(user.organizationId, program.id, participantId);
    if (participant.status !== PilotParticipantStatus.ACTIVE) throw new BadRequestException('El participante no está activo');
    const evidence = dto.evidence.trim();
    const updated = await this.prisma.pilotParticipant.update({
      where: { id: participant.id },
      data: { trainingEvidence: evidence, trainedAt: new Date(), trainedById: user.userId },
      include: { trainedBy: { select: { id: true, displayName: true } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_TRAINING_CONFIRMED',
      entityType: 'PilotParticipant',
      entityId: participant.id,
      payload: { evidence },
    });
    return updated;
  }

  async addValidation(user: AuthenticatedUser, dto: CreatePilotValidationDto) {
    const program = await this.ensureProgram(user);
    if (program.status === PilotProgramStatus.COMPLETED) throw new BadRequestException('El piloto ya está cerrado');
    const matter = await this.prisma.matter.findFirst({
      where: { id: dto.matterId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    const existing = await this.prisma.pilotValidation.findUnique({
      where: { programId_matterId: { programId: program.id, matterId: matter.id } },
    });
    if (existing) throw new ConflictException('El expediente ya forma parte de la operación paralela');
    const validation = await this.prisma.pilotValidation.create({
      data: {
        organizationId: user.organizationId,
        programId: program.id,
        matterId: matter.id,
        legacyReference: dto.legacyReference?.trim(),
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: matter.id,
      actorUserId: user.userId,
      action: 'PILOT_VALIDATION_CREATED',
      entityType: 'PilotValidation',
      entityId: validation.id,
    });
    return validation;
  }

  async reviewValidation(user: AuthenticatedUser, validationId: string, dto: ReviewPilotValidationDto) {
    if (dto.result === PilotValidationResult.PENDING) throw new BadRequestException('Selecciona coincidencia o diferencia');
    const program = await this.ensureProgram(user);
    if (program.status === PilotProgramStatus.COMPLETED) throw new BadRequestException('El piloto ya está cerrado');
    const current = await this.prisma.pilotValidation.findFirst({
      where: { id: validationId, organizationId: user.organizationId, programId: program.id },
    });
    if (!current) throw new NotFoundException('Caso de operación paralela no encontrado');
    const validation = await this.prisma.pilotValidation.update({
      where: { id: current.id },
      data: {
        result: dto.result,
        notes: dto.notes.trim(),
        validatedById: user.userId,
        validatedAt: new Date(),
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: current.matterId,
      actorUserId: user.userId,
      action: 'PILOT_VALIDATION_REVIEWED',
      entityType: 'PilotValidation',
      entityId: current.id,
      payload: { result: dto.result, notes: dto.notes.trim() },
    });
    return validation;
  }

  async createIssue(user: AuthenticatedUser, dto: CreatePilotIssueDto) {
    const program = await this.ensureProgram(user);
    if (program.status === PilotProgramStatus.COMPLETED) throw new BadRequestException('El piloto ya está cerrado');
    await this.validateMatterAndAssignee(user.organizationId, dto.matterId, dto.assignedMembershipId);
    const issue = await this.prisma.pilotIssue.create({
      data: {
        organizationId: user.organizationId,
        programId: program.id,
        matterId: dto.matterId,
        category: dto.category.trim(),
        severity: dto.severity,
        title: dto.title.trim(),
        description: dto.description.trim(),
        assignedMembershipId: dto.assignedMembershipId,
        reportedById: user.userId,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: issue.matterId ?? undefined,
      actorUserId: user.userId,
      action: 'PILOT_ISSUE_REPORTED',
      entityType: 'PilotIssue',
      entityId: issue.id,
      payload: { severity: issue.severity, category: issue.category, title: issue.title },
    });
    return issue;
  }

  async updateIssue(user: AuthenticatedUser, issueId: string, dto: UpdatePilotIssueDto) {
    const program = await this.ensureProgram(user);
    if (program.status === PilotProgramStatus.COMPLETED) throw new BadRequestException('El piloto ya está cerrado');
    const issue = await this.prisma.pilotIssue.findFirst({
      where: { id: issueId, organizationId: user.organizationId, programId: program.id },
    });
    if (!issue) throw new NotFoundException('Incidencia de piloto no encontrada');
    await this.validateMatterAndAssignee(user.organizationId, undefined, dto.assignedMembershipId);
    const resolving = ([PilotIssueStatus.RESOLVED, PilotIssueStatus.CLOSED] as PilotIssueStatus[]).includes(dto.status);
    const resolution = dto.resolution?.trim();
    if (resolving && (!resolution || resolution.length < 10)) {
      throw new BadRequestException('La resolución debe tener al menos 10 caracteres');
    }
    const updated = await this.prisma.pilotIssue.update({
      where: { id: issue.id },
      data: {
        status: dto.status,
        ...(dto.assignedMembershipId === undefined ? {} : { assignedMembershipId: dto.assignedMembershipId || null }),
        resolution: resolving ? resolution : null,
        resolvedAt: resolving ? new Date() : null,
        resolvedById: resolving ? user.userId : null,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: issue.matterId ?? undefined,
      actorUserId: user.userId,
      action: 'PILOT_ISSUE_UPDATED',
      entityType: 'PilotIssue',
      entityId: issue.id,
      payload: { from: issue.status, to: updated.status, resolution: updated.resolution },
    });
    return updated;
  }

  async previewImport(user: AuthenticatedUser, dto: CreatePilotImportDto) {
    const program = await this.ensureProgram(user);
    if (([PilotProgramStatus.ACTIVE, PilotProgramStatus.PAUSED, PilotProgramStatus.COMPLETED] as PilotProgramStatus[]).includes(program.status)) {
      throw new BadRequestException('Las importaciones se cierran al iniciar el piloto');
    }
    const people = dto.people.map((person) => this.normalizePerson(person));
    const checksum = createHash('sha256').update(JSON.stringify({ sourceName: dto.sourceName.trim(), people })).digest('hex');
    const existingBatch = await this.prisma.pilotImportBatch.findUnique({
      where: { programId_checksum: { programId: program.id, checksum } },
    });
    if (existingBatch) return { ...existingBatch, reused: true };
    const validation = await this.validateImportRows(user.organizationId, people);
    const invalidRows = validation.filter((row) => !row.valid).length;
    const batch = await this.prisma.pilotImportBatch.create({
      data: {
        organizationId: user.organizationId,
        programId: program.id,
        sourceName: dto.sourceName.trim(),
        checksum,
        status: invalidRows === 0 ? PilotImportStatus.READY : PilotImportStatus.BLOCKED,
        totalRows: people.length,
        validRows: people.length - invalidRows,
        invalidRows,
        payload: people as unknown as Prisma.InputJsonValue,
        validation: validation as unknown as Prisma.InputJsonValue,
        createdById: user.userId,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_IMPORT_PREVIEWED',
      entityType: 'PilotImportBatch',
      entityId: batch.id,
      payload: { sourceName: batch.sourceName, totalRows: batch.totalRows, invalidRows, checksum },
    });
    return batch;
  }

  async commitImport(user: AuthenticatedUser, batchId: string) {
    const program = await this.ensureProgram(user);
    if (!([PilotProgramStatus.DRAFT, PilotProgramStatus.READY] as PilotProgramStatus[]).includes(program.status)) {
      throw new BadRequestException('Las importaciones se cierran al iniciar el piloto');
    }
    const batch = await this.prisma.pilotImportBatch.findFirst({
      where: { id: batchId, organizationId: user.organizationId, programId: program.id },
    });
    if (!batch) throw new NotFoundException('Lote de migración no encontrado');
    if (batch.status === PilotImportStatus.COMMITTED) return batch;
    if (batch.status !== PilotImportStatus.READY) throw new BadRequestException('El lote debe estar validado y sin errores');
    const people = batch.payload as unknown as ReturnType<PilotOperationsService['normalizePerson']>[];
    const currentValidation = await this.validateImportRows(user.organizationId, people);
    if (currentValidation.some((row) => !row.valid)) {
      await this.prisma.pilotImportBatch.update({
        where: { id: batch.id },
        data: {
          status: PilotImportStatus.BLOCKED,
          validation: currentValidation as unknown as Prisma.InputJsonValue,
          invalidRows: currentValidation.filter((row) => !row.valid).length,
          validRows: currentValidation.filter((row) => row.valid).length,
        },
      });
      throw new ConflictException('Los datos cambiaron desde la vista previa; revisa nuevamente el lote');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const person of people) {
        const created = await tx.person.create({ data: { organizationId: user.organizationId, ...person } });
        ids.push(created.id);
      }
      return tx.pilotImportBatch.update({
        where: { id: batch.id },
        data: {
          status: PilotImportStatus.COMMITTED,
          importedRows: ids.length,
          importedEntityIds: ids,
          committedById: user.userId,
          committedAt: new Date(),
        },
      });
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_IMPORT_COMMITTED',
      entityType: 'PilotImportBatch',
      entityId: batch.id,
      payload: { sourceName: batch.sourceName, importedRows: result.importedRows, checksum: batch.checksum },
    });
    return result;
  }

  async cancelImport(user: AuthenticatedUser, batchId: string, dto: CancelPilotImportDto) {
    const program = await this.ensureProgram(user);
    if (program.status === PilotProgramStatus.COMPLETED) throw new BadRequestException('El piloto ya está cerrado');
    const batch = await this.prisma.pilotImportBatch.findFirst({
      where: { id: batchId, organizationId: user.organizationId, programId: program.id },
    });
    if (!batch) throw new NotFoundException('Lote de migración no encontrado');
    if (batch.status === PilotImportStatus.COMMITTED) throw new BadRequestException('Un lote importado no puede cancelarse');
    const updated = await this.prisma.pilotImportBatch.update({
      where: { id: batch.id },
      data: { status: PilotImportStatus.CANCELLED },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_IMPORT_CANCELLED',
      entityType: 'PilotImportBatch',
      entityId: batch.id,
      payload: { reason: dto.reason.trim() },
    });
    return updated;
  }

  async exportCsv(user: AuthenticatedUser) {
    const overview = await this.overview(user);
    const rows: unknown[][] = [
      ['Operación del piloto'],
      ['Programa', overview.program.name],
      ['Estado', overview.program.status],
      ['Despliegue', `${overview.program.rolloutPercentage}%`],
      [],
      ['Categoría', 'Elemento', 'Estado', 'Detalle', 'Responsable', 'Fecha'],
      ...overview.gates.checks.map((gate) => ['Compuerta', gate.label, gate.status, gate.detail, '', overview.program.updatedAt.toISOString()]),
      ...overview.participants.map((item) => ['Participante', item.membership.user.displayName, item.status, item.trainingEvidence ?? 'Sin capacitación', item.trainedBy?.displayName ?? '', item.trainedAt?.toISOString() ?? item.addedAt.toISOString()]),
      ...overview.validations.map((item) => ['Operación paralela', item.matter.reference, item.result, item.notes ?? '', item.validatedBy?.displayName ?? '', item.validatedAt?.toISOString() ?? item.createdAt.toISOString()]),
      ...overview.issues.map((item) => ['Incidencia', item.title, `${item.severity}/${item.status}`, item.resolution ?? item.description, item.assignedMembership?.user.displayName ?? '', item.resolvedAt?.toISOString() ?? item.reportedAt.toISOString()]),
      ...overview.imports.map((item) => ['Migración', item.sourceName, item.status, `${item.importedRows}/${item.totalRows} importados`, item.committedBy?.displayName ?? item.createdBy.displayName, item.committedAt?.toISOString() ?? item.createdAt.toISOString()]),
    ];
    return {
      fileName: `operacion-piloto-${new Date().toISOString().slice(0, 10)}.csv`,
      content: `\uFEFF${rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\r\n')}`,
    };
  }

  private async ensureProgram(user: AuthenticatedUser) {
    const current = await this.prisma.pilotProgram.findFirst({
      where: { organizationId: user.organizationId, current: true },
    });
    if (current) return current;
    try {
      return await this.prisma.pilotProgram.create({
        data: {
          organizationId: user.organizationId,
          name: `${user.organizationName} · Piloto controlado`,
          current: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.pilotProgram.findFirstOrThrow({
          where: { organizationId: user.organizationId, current: true },
        });
      }
      throw error;
    }
  }

  private participant(organizationId: string, programId: string, id: string) {
    return this.prisma.pilotParticipant.findFirstOrThrow({ where: { id, organizationId, programId } });
  }

  private gate(code: string, label: string, passed: boolean, detail: string, value: number) {
    return { code, label, status: passed ? 'PASS' as const : 'BLOCKED' as const, blocking: true, detail, value };
  }

  private async validateMatterAndAssignee(organizationId: string, matterId?: string, membershipId?: string) {
    const [matter, membership] = await Promise.all([
      matterId ? this.prisma.matter.findFirst({ where: { id: matterId, organizationId }, select: { id: true } }) : undefined,
      membershipId ? this.prisma.membership.findFirst({ where: { id: membershipId, organizationId, user: { active: true } }, select: { id: true } }) : undefined,
    ]);
    if (matterId && !matter) throw new BadRequestException('El expediente no pertenece a la organización activa');
    if (membershipId && !membership) throw new BadRequestException('El responsable no pertenece a la organización activa');
  }

  private normalizePerson(person: PilotImportPersonDto) {
    return {
      type: person.type,
      legalName: person.legalName.trim(),
      taxId: person.taxId?.trim().toUpperCase() || null,
      email: person.email?.trim().toLowerCase() || null,
      phone: person.phone?.trim() || null,
      addressLine1: person.addressLine1?.trim() || null,
      city: person.city?.trim() || null,
      state: person.state?.trim() || null,
      postalCode: person.postalCode?.trim() || null,
      country: person.country?.trim() || 'México',
      identificationType: person.identificationType?.trim() || null,
      identificationNumber: person.identificationNumber?.trim() || null,
    };
  }

  private async validateImportRows(
    organizationId: string,
    people: ReturnType<PilotOperationsService['normalizePerson']>[],
  ) {
    const taxIds = people.flatMap((person) => person.taxId ? [person.taxId] : []);
    const emails = people.flatMap((person) => person.email ? [person.email] : []);
    const existing = taxIds.length || emails.length ? await this.prisma.person.findMany({
      where: {
        organizationId,
        OR: [
          ...(taxIds.length ? [{ taxId: { in: taxIds } }] : []),
          ...(emails.length ? [{ email: { in: emails, mode: 'insensitive' as const } }] : []),
        ],
      },
      select: { id: true, taxId: true, email: true },
    }) : [];
    const existingTaxIds = new Set(existing.flatMap((person) => person.taxId ? [person.taxId.toUpperCase()] : []));
    const existingEmails = new Set(existing.flatMap((person) => person.email ? [person.email.toLowerCase()] : []));
    const seenTaxIds = new Set<string>();
    const seenEmails = new Set<string>();
    return people.map((person, index) => {
      const errors: string[] = [];
      if (person.taxId && existingTaxIds.has(person.taxId)) errors.push('RFC ya registrado en la organización');
      if (person.email && existingEmails.has(person.email)) errors.push('Correo ya registrado en la organización');
      if (person.taxId && seenTaxIds.has(person.taxId)) errors.push('RFC duplicado dentro del lote');
      if (person.email && seenEmails.has(person.email)) errors.push('Correo duplicado dentro del lote');
      if (person.taxId) seenTaxIds.add(person.taxId);
      if (person.email) seenEmails.add(person.email);
      return { row: index + 1, legalName: person.legalName, valid: errors.length === 0, errors };
    });
  }

  private csvCell(value: unknown) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }
}
