import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExtractionStatus,
  MembershipRole,
  PilotCheckpointStatus,
  TaskStatus,
} from '@despacho/database';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CompletePilotCheckpointDto, ReopenPilotCheckpointDto } from './dto/pilot-checkpoint.dto';
import { PilotOperationsService } from './pilot-operations.service';

const CHECKPOINT_DEFINITIONS = [
  {
    code: 'DATA_SAMPLE_VALIDATED',
    label: 'Muestra de datos validada',
    description: 'Revisar una muestra representativa de expedientes, personas, inmuebles y documentos migrados.',
  },
  {
    code: 'USERS_TRAINED',
    label: 'Usuarios capacitados',
    description: 'Confirmar que responsables y personal operativo completaron la capacitación del flujo acordado.',
  },
  {
    code: 'PARALLEL_OPERATION_VALIDATED',
    label: 'Operación paralela validada',
    description: 'Ejecutar casos reales en paralelo con el proceso vigente y conciliar los resultados.',
  },
  {
    code: 'SUPPORT_CHANNEL_READY',
    label: 'Canal de soporte listo',
    description: 'Definir responsables, horario, canal y tiempo objetivo para atender incidentes del piloto.',
  },
  {
    code: 'BACKUP_RESTORE_VERIFIED',
    label: 'Respaldo y restauración verificados',
    description: 'Documentar y probar el respaldo de base de datos y archivos, incluyendo una restauración.',
  },
] as const;

type CheckpointCode = (typeof CHECKPOINT_DEFINITIONS)[number]['code'];

@Injectable()
export class PilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly operations: PilotOperationsService,
  ) {}

  async readiness(user: AuthenticatedUser) {
    await this.ensureCheckpoints(user.organizationId);
    const operationalGates = await this.operations.gates(user);
    const now = new Date();
    const [
      checkpoints,
      activeAdmins,
      activeUsers,
      pendingExtractions,
      overdueTasks,
    ] = await Promise.all([
      this.prisma.pilotCheckpoint.findMany({
        where: { organizationId: user.organizationId },
        include: { completedBy: { select: { id: true, displayName: true, email: true } } },
      }),
      this.prisma.membership.count({
        where: {
          organizationId: user.organizationId,
          role: MembershipRole.ADMIN,
          user: { active: true },
        },
      }),
      this.prisma.membership.count({
        where: { organizationId: user.organizationId, user: { active: true } },
      }),
      this.prisma.documentExtractionRun.count({
        where: {
          organizationId: user.organizationId,
          status: { in: [ExtractionStatus.MANUAL_REVIEW, ExtractionStatus.PROCESSING] },
          review: { is: null },
        },
      }),
      this.prisma.task.count({
        where: {
          organizationId: user.organizationId,
          status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] },
          dueAt: { lt: now },
        },
      }),
    ]);

    const storageDriver = this.config.get<string>('STORAGE_DRIVER', 'local').toLowerCase();
    const technicalChecks = [
      this.check('DATABASE_CONNECTION', 'Base de datos disponible', 'PASS', true,
        'La consulta de diagnóstico y los conteos multitenant respondieron correctamente.'),
      this.check('ACTIVE_ADMIN', 'Administrador activo', activeAdmins > 0 ? 'PASS' : 'BLOCKED', true,
        activeAdmins > 0 ? `${activeAdmins} administrador(es) activo(s).` : 'No existe un administrador activo.', activeAdmins),
      this.check('ADMIN_REDUNDANCY', 'Cobertura administrativa', activeAdmins >= 2 ? 'PASS' : 'WARNING', false,
        activeAdmins >= 2 ? 'Existe cobertura administrativa de respaldo.' : 'Sólo existe un administrador activo; define un respaldo.', activeAdmins),
      this.check('ACTIVE_USERS', 'Usuarios activos', activeUsers >= 2 ? 'PASS' : 'WARNING', false,
        activeUsers >= 2 ? `${activeUsers} usuarios activos disponibles.` : 'El piloto tiene menos de dos usuarios activos.', activeUsers),
      this.check('OBJECT_STORAGE', 'Almacenamiento de archivos', storageDriver === 's3' ? 'PASS' : 'WARNING', false,
        storageDriver === 's3'
          ? 'El adaptador S3-compatible está habilitado.'
          : 'Se usa almacenamiento local; es válido para el piloto, pero requiere respaldo operativo.'),
      this.check('PENDING_EXTRACTIONS', 'Extracciones pendientes de revisión', pendingExtractions === 0 ? 'PASS' : 'WARNING', false,
        pendingExtractions === 0 ? 'No hay extracciones pendientes.' : `${pendingExtractions} extracción(es) requieren revisión humana.`, pendingExtractions),
      this.check('OVERDUE_TASKS', 'Tareas vencidas', overdueTasks === 0 ? 'PASS' : 'WARNING', false,
        overdueTasks === 0 ? 'No hay tareas abiertas vencidas.' : `${overdueTasks} tarea(s) abierta(s) están vencidas.`, overdueTasks),
      this.check('EXTRACTION_ADAPTER', 'Extracción documental', 'WARNING', false,
        'La extracción siempre exige revisión humana. La lectura de INE con IA es opcional y requiere activación y validación del proveedor.'),
      this.check('SIGNATURE_ADAPTER', 'Firma de documentos', 'WARNING', false,
        'El puerto está preparado, pero la evidencia firmada se incorpora manualmente.'),
      this.check('NOTIFICATION_ADAPTER', 'Avisos externos', 'WARNING', false,
        'Los avisos in-app están activos; correo y calendario permanecen desacoplados hasta elegir proveedor.'),
      ...operationalGates.checks,
    ];

    const checkpointByCode = new Map(checkpoints.map((checkpoint) => [checkpoint.code, checkpoint]));
    const orderedCheckpoints = CHECKPOINT_DEFINITIONS.map((definition) => {
      const checkpoint = checkpointByCode.get(definition.code)!;
      return { ...checkpoint, description: definition.description };
    });
    const technicalBlockers = technicalChecks.filter((item) => item.status === 'BLOCKED').length;
    const manualBlockers = orderedCheckpoints.filter((item) => (
      item.blocking && item.status !== PilotCheckpointStatus.COMPLETE
    )).length;
    const warnings = technicalChecks.filter((item) => item.status === 'WARNING').length;
    const passed = technicalChecks.filter((item) => item.status === 'PASS').length
      + orderedCheckpoints.filter((item) => item.status === PilotCheckpointStatus.COMPLETE).length;
    const blockers = technicalBlockers + manualBlockers;

    return {
      generatedAt: now.toISOString(),
      readyForPilot: blockers === 0,
      summary: {
        blockers,
        warnings,
        passed,
        manualCompleted: orderedCheckpoints.length - manualBlockers,
        manualTotal: orderedCheckpoints.length,
      },
      technicalChecks,
      checkpoints: orderedCheckpoints,
      operationalGates,
    };
  }

  async completeCheckpoint(
    user: AuthenticatedUser,
    rawCode: string,
    dto: CompletePilotCheckpointDto,
  ) {
    const code = this.checkpointCode(rawCode);
    const evidence = dto.evidence.trim();
    if (evidence.length < 10) throw new BadRequestException('La evidencia debe tener al menos 10 caracteres');
    await this.ensureCheckpoints(user.organizationId);
    const current = await this.checkpoint(user.organizationId, code);
    if (current.status === PilotCheckpointStatus.COMPLETE) return current;
    const checkpoint = await this.prisma.pilotCheckpoint.update({
      where: { organizationId_code: { organizationId: user.organizationId, code } },
      data: {
        status: PilotCheckpointStatus.COMPLETE,
        evidence,
        completedById: user.userId,
        completedAt: new Date(),
      },
      include: { completedBy: { select: { id: true, displayName: true, email: true } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_CHECKPOINT_COMPLETED',
      entityType: 'PilotCheckpoint',
      entityId: checkpoint.id,
      payload: { code, evidence },
    });
    return checkpoint;
  }

  async reopenCheckpoint(
    user: AuthenticatedUser,
    rawCode: string,
    dto: ReopenPilotCheckpointDto,
  ) {
    const code = this.checkpointCode(rawCode);
    const reason = dto.reason.trim();
    if (reason.length < 10) throw new BadRequestException('El motivo debe tener al menos 10 caracteres');
    await this.ensureCheckpoints(user.organizationId);
    const current = await this.checkpoint(user.organizationId, code);
    if (current.status === PilotCheckpointStatus.PENDING) return current;
    const checkpoint = await this.prisma.pilotCheckpoint.update({
      where: { organizationId_code: { organizationId: user.organizationId, code } },
      data: {
        status: PilotCheckpointStatus.PENDING,
        evidence: null,
        completedById: null,
        completedAt: null,
      },
      include: { completedBy: { select: { id: true, displayName: true, email: true } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PILOT_CHECKPOINT_REOPENED',
      entityType: 'PilotCheckpoint',
      entityId: checkpoint.id,
      payload: { code, reason },
    });
    return checkpoint;
  }

  async exportCsv(user: AuthenticatedUser) {
    const diagnosis = await this.readiness(user);
    const rows: unknown[][] = [
      ['Diagnóstico de preparación para piloto'],
      ['Generado', diagnosis.generatedAt],
      ['Resultado', diagnosis.readyForPilot ? 'LISTO' : 'NO LISTO'],
      ['Bloqueantes', diagnosis.summary.blockers],
      ['Advertencias', diagnosis.summary.warnings],
      [],
      ['Categoría', 'Código', 'Control', 'Resultado', 'Bloqueante', 'Detalle / evidencia', 'Responsable', 'Fecha'],
      ...diagnosis.technicalChecks.map((item) => [
        'Técnico', item.code, item.label, item.status, item.blocking ? 'Sí' : 'No', item.detail, '', diagnosis.generatedAt,
      ]),
      ...diagnosis.checkpoints.map((item) => [
        'Operativo', item.code, item.label, item.status, item.blocking ? 'Sí' : 'No', item.evidence ?? item.description,
        item.completedBy?.displayName ?? '', item.completedAt?.toISOString() ?? '',
      ]),
    ];
    return {
      fileName: `preparacion-piloto-${diagnosis.generatedAt.slice(0, 10)}.csv`,
      content: `\uFEFF${rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\r\n')}`,
    };
  }

  private check(
    code: string,
    label: string,
    status: 'PASS' | 'WARNING' | 'BLOCKED',
    blocking: boolean,
    detail: string,
    value?: number,
  ) {
    return { code, label, status, blocking, detail, ...(value === undefined ? {} : { value }) };
  }

  private checkpointCode(rawCode: string): CheckpointCode {
    const code = rawCode.trim().toUpperCase();
    if (!CHECKPOINT_DEFINITIONS.some((definition) => definition.code === code)) {
      throw new NotFoundException('Checkpoint de piloto no encontrado');
    }
    return code as CheckpointCode;
  }

  private checkpoint(organizationId: string, code: CheckpointCode) {
    return this.prisma.pilotCheckpoint.findUniqueOrThrow({
      where: { organizationId_code: { organizationId, code } },
      include: { completedBy: { select: { id: true, displayName: true, email: true } } },
    });
  }

  private async ensureCheckpoints(organizationId: string) {
    await this.prisma.$transaction(CHECKPOINT_DEFINITIONS.map((definition) => (
      this.prisma.pilotCheckpoint.upsert({
        where: { organizationId_code: { organizationId, code: definition.code } },
        create: {
          organizationId,
          code: definition.code,
          label: definition.label,
          blocking: true,
        },
        update: { label: definition.label, blocking: true },
      })
    )));
  }

  private csvCell(value: unknown) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }
}
