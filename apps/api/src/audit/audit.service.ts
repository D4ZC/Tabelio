import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@despacho/database';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditQueryDto } from './dto/audit-query.dto';

const DAY_MS = 86_400_000;

interface RecordAuditInput {
  organizationId: string;
  matterId?: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: RecordAuditInput, transaction?: Prisma.TransactionClient) {
    return (transaction ?? this.prisma).auditEvent.create({
      data: {
        ...input,
        payload: input.payload as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async list(user: AuthenticatedUser, query: AuditQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where = this.where(user.organizationId, query);
    const [events, total, systemEvents, withMatter, actions, entityTypes, actors] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          payload: true,
          createdAt: true,
          actor: { select: { id: true, displayName: true, email: true } },
          matter: { select: { id: true, reference: true, title: true, status: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.count({ where: { AND: [where, { actorUserId: null }] } }),
      this.prisma.auditEvent.count({ where: { AND: [where, { matterId: { not: null } }] } }),
      this.prisma.auditEvent.findMany({
        where: { organizationId: user.organizationId },
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      }),
      this.prisma.auditEvent.findMany({
        where: { organizationId: user.organizationId },
        distinct: ['entityType'],
        select: { entityType: true },
        orderBy: { entityType: 'asc' },
      }),
      this.prisma.membership.findMany({
        where: { organizationId: user.organizationId },
        select: { user: { select: { id: true, displayName: true, email: true } } },
        orderBy: { user: { displayName: 'asc' } },
      }),
    ]);
    return {
      period: this.resolvePeriod(query),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: { total, systemEvents, actorEvents: total - systemEvents, withMatter },
      facets: {
        actions: actions.map((item) => item.action),
        entityTypes: entityTypes.map((item) => item.entityType),
        actors: actors.map((item) => item.user),
      },
      events,
    };
  }

  async exportCsv(user: AuthenticatedUser, query: AuditQueryDto) {
    const where = this.where(user.organizationId, query);
    const [total, events] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        select: {
          createdAt: true,
          action: true,
          entityType: true,
          entityId: true,
          payload: true,
          actor: { select: { displayName: true, email: true } },
          matter: { select: { reference: true, title: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10_001,
      }),
    ]);
    if (total > 10_000) {
      throw new BadRequestException('La exportación supera 10,000 eventos; reduce el periodo o aplica filtros');
    }
    const period = this.resolvePeriod(query);
    const rows: unknown[][] = [
      ['Fecha', 'Acción', 'Entidad', 'ID de entidad', 'Responsable', 'Correo', 'Expediente', 'Título', 'Detalle'],
      ...events.map((event) => [
        event.createdAt.toISOString(),
        event.action,
        event.entityType,
        event.entityId,
        event.actor?.displayName ?? 'Sistema',
        event.actor?.email ?? '',
        event.matter?.reference ?? '',
        event.matter?.title ?? '',
        event.payload ? JSON.stringify(event.payload) : '',
      ]),
    ];
    return {
      fileName: `auditoria-${period.from.slice(0, 10)}-${period.to.slice(0, 10)}.csv`,
      content: `\uFEFF${rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\r\n')}`,
    };
  }

  private where(organizationId: string, query: AuditQueryDto): Prisma.AuditEventWhereInput {
    const period = this.resolvePeriod(query);
    const text = query.q?.trim();
    return {
      organizationId,
      createdAt: { gte: new Date(period.from), lte: new Date(period.to) },
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.actorUserId === 'SYSTEM'
        ? { actorUserId: null }
        : query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.matterId ? { matterId: query.matterId } : {}),
      ...(text ? {
        OR: [
          { action: { contains: text, mode: 'insensitive' } },
          { entityType: { contains: text, mode: 'insensitive' } },
          { entityId: { contains: text, mode: 'insensitive' } },
          { actor: { is: { OR: [
            { displayName: { contains: text, mode: 'insensitive' } },
            { email: { contains: text, mode: 'insensitive' } },
          ] } } },
          { matter: { is: { OR: [
            { reference: { contains: text, mode: 'insensitive' } },
            { title: { contains: text, mode: 'insensitive' } },
          ] } } },
        ],
      } : {}),
    };
  }

  private resolvePeriod(query: AuditQueryDto) {
    const to = query.to ? this.dateBoundary(query.to, 'end') : new Date();
    const from = query.from ? this.dateBoundary(query.from, 'start') : new Date(to.getTime() - 29 * DAY_MS);
    if (from > to) throw new BadRequestException('La fecha inicial no puede ser posterior a la final');
    if (to.getTime() - from.getTime() > 366 * DAY_MS) {
      throw new BadRequestException('El periodo máximo de auditoría es de 366 días');
    }
    return { from: from.toISOString(), to: to.toISOString() };
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
