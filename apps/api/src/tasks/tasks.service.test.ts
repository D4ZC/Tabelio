import { TaskPriority, TaskStatus } from '@despacho/database';
import { describe, expect, it, vi } from 'vitest';
import {
  documentValidityTaskPlan,
  createsTaskDependencyCycle,
  isDocumentValidEvidence,
  taskSlaEscalationPlan,
  TasksService,
} from './tasks.service';

const asOf = new Date('2026-10-09T18:00:00.000Z');

describe('resumen de tareas pendientes para el asistente', () => {
  function task(id: string, status: TaskStatus, priority: TaskPriority, dueAt: Date | null) {
    return {
      id, title: `Tarea ${id}`, status, priority, dueAt,
      matter: { id: 'matter-1', reference: 'EXP-DEMO', title: 'Arrendamiento demo' },
      assignee: { id: 'member-1', user: { displayName: 'Diego' } },
    };
  }

  it('incluye todas las prioridades y estados abiertos, incluso fechas lejanas y tareas sin vencimiento', async () => {
    const prisma = { task: { findMany: vi.fn().mockResolvedValue([
      task('vencida', TaskStatus.TODO, TaskPriority.URGENT, new Date('2026-10-08')),
      task('en-curso', TaskStatus.IN_PROGRESS, TaskPriority.HIGH, new Date('2026-10-30')),
      task('bloqueada', TaskStatus.BLOCKED, TaskPriority.LOW, null),
      task('ahora', TaskStatus.TODO, TaskPriority.NORMAL, asOf),
      task('terminada', TaskStatus.DONE, TaskPriority.NORMAL, new Date('2026-10-08')),
      task('cancelada', TaskStatus.CANCELLED, TaskPriority.HIGH, null),
    ]) } };
    const service = new TasksService(prisma as never, {} as never, {} as never);
    const user = { organizationId: 'org-1', membershipId: 'member-1' };
    const summary = await service.pendingSummary(user as never, {}, asOf);

    expect(summary.total).toBe(4);
    expect(summary.overdue.items.map((item) => item.id)).toEqual(['vencida']);
    expect(summary.inTime.items.map((item) => item.id)).toEqual(['en-curso', 'ahora']);
    expect(summary.noDueDate.items.map((item) => item.id)).toEqual(['bloqueada']);
    expect(summary.inTime.items[0]).toMatchObject({
      matter: { reference: 'EXP-DEMO' }, assignee: { displayName: 'Diego' },
    });
    expect(prisma.task.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1', assigneeMembershipId: 'member-1',
    });
  });

  it('limita el detalle sin perder los conteos ni ocultar que existen más resultados', async () => {
    const prisma = { task: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({
      ...task(String(index), TaskStatus.TODO, TaskPriority.NORMAL, null), assignee: null,
    }))) } };
    const service = new TasksService(prisma as never, {} as never, {} as never);
    const summary = await service.pendingSummary({ organizationId: 'org-1' } as never, { assignee: 'all' }, asOf);
    expect(summary.total).toBe(12);
    expect(summary.noDueDate).toMatchObject({ total: 12, hasMore: true });
    expect(summary.noDueDate.items).toHaveLength(8);
    expect(summary.noDueDate.items[0].assignee).toBeNull();
    expect(summary.overdue).toEqual({ total: 0, hasMore: false, items: [] });
    expect(prisma.task.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1' });
  });

  it('permite acotar la demo por título sin cambiar la identidad ni añadir filtros de prioridad', async () => {
    const prisma = { task: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new TasksService(prisma as never, {} as never, {} as never);
    const summary = await service.pendingSummary({
      organizationId: 'org-1', membershipId: 'member-1',
    } as never, { q: 'DEMO IA' }, asOf);
    expect(summary.total).toBe(0);
    expect(prisma.task.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org-1', assigneeMembershipId: 'member-1',
      OR: expect.arrayContaining([{ matter: { title: { contains: 'DEMO IA', mode: 'insensitive' } } }]),
    });
    expect(prisma.task.findMany.mock.calls[0][0].where).not.toHaveProperty('priority');
    expect(prisma.task.findMany.mock.calls[0][0].where).not.toHaveProperty('status');
  });
});

describe('planeación de tareas de vigencia documental', () => {
  it('prioriza como urgente los documentos vencidos o dentro de 15 días', () => {
    expect(documentValidityTaskPlan(new Date('2026-10-01'), asOf)).toEqual({
      daysRemaining: -8,
      priority: TaskPriority.URGENT,
    });
    expect(documentValidityTaskPlan(new Date('2026-10-24'), asOf)?.priority).toBe(TaskPriority.URGENT);
  });

  it('crea prioridad alta entre 16 y 30 días', () => {
    expect(documentValidityTaskPlan(new Date('2026-10-25'), asOf)).toEqual({
      daysRemaining: 16,
      priority: TaskPriority.HIGH,
    });
    expect(documentValidityTaskPlan(new Date('2026-11-08'), asOf)?.priority).toBe(TaskPriority.HIGH);
  });

  it('no crea una tarea fuera de la ventana de 30 días', () => {
    expect(documentValidityTaskPlan(new Date('2026-11-09'), asOf)).toBeNull();
  });
});

describe('vigencia de evidencia para tareas', () => {
  it('acepta documentos sin vencimiento y los que vencen durante el día actual', () => {
    expect(isDocumentValidEvidence(null, asOf)).toBe(true);
    expect(isDocumentValidEvidence(new Date('2026-10-09T00:00:00.000Z'), asOf)).toBe(true);
  });

  it('rechaza documentos vencidos antes del día de consulta', () => {
    expect(isDocumentValidEvidence(new Date('2026-10-08T23:59:59.000Z'), asOf)).toBe(false);
  });
});

describe('dependencias entre tareas', () => {
  const dependencies = [
    { taskId: 'redactar', dependsOnTaskId: 'integrar' },
    { taskId: 'aprobar', dependsOnTaskId: 'redactar' },
  ];

  it('detecta ciclos directos e indirectos', () => {
    expect(createsTaskDependencyCycle(dependencies, 'integrar', 'redactar')).toBe(true);
    expect(createsTaskDependencyCycle(dependencies, 'integrar', 'aprobar')).toBe(true);
  });

  it('acepta una dependencia acíclica', () => {
    expect(createsTaskDependencyCycle(dependencies, 'firmar', 'aprobar')).toBe(false);
  });
});

describe('escalación determinista de SLA', () => {
  it('eleva a prioridad alta durante los primeros dos días de atraso', () => {
    expect(taskSlaEscalationPlan(
      new Date('2026-10-08T18:00:00.000Z'),
      TaskStatus.TODO,
      TaskPriority.NORMAL,
      asOf,
    )).toEqual({ daysOverdue: 1, level: 1, priority: TaskPriority.HIGH });
  });

  it('eleva a urgente desde el tercer día sin reducir una prioridad existente', () => {
    expect(taskSlaEscalationPlan(
      new Date('2026-10-06T18:00:00.000Z'),
      TaskStatus.BLOCKED,
      TaskPriority.LOW,
      asOf,
    )).toEqual({ daysOverdue: 3, level: 2, priority: TaskPriority.URGENT });
    expect(taskSlaEscalationPlan(
      new Date('2026-10-08T18:00:00.000Z'),
      TaskStatus.IN_PROGRESS,
      TaskPriority.URGENT,
      asOf,
    )?.priority).toBe(TaskPriority.URGENT);
  });

  it('ignora tareas cerradas, sin vencimiento o todavía dentro del plazo', () => {
    expect(taskSlaEscalationPlan(null, TaskStatus.TODO, TaskPriority.NORMAL, asOf)).toBeNull();
    expect(taskSlaEscalationPlan(
      new Date('2026-10-10T18:00:00.000Z'),
      TaskStatus.TODO,
      TaskPriority.NORMAL,
      asOf,
    )).toBeNull();
    expect(taskSlaEscalationPlan(
      new Date('2026-10-01T18:00:00.000Z'),
      TaskStatus.DONE,
      TaskPriority.NORMAL,
      asOf,
    )).toBeNull();
  });
});
