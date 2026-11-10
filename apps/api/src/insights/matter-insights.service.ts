import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MattersService } from '../matters/matters.service';
import { InsightAiService, type InsightAiResult, type InsightSource } from './insight-ai.service';
import type { InsightOptions, InsightResult } from './insight.types';

type Matter = Awaited<ReturnType<MattersService['get']>>;
type Item = InsightAiResult['items'][number];
const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador', INTEGRATION: 'Integración', PENDING_CLIENT: 'Pendiente del cliente', VALIDATION: 'Validación',
  DRAFTING: 'Elaboración', REVIEW: 'Revisión jurídica', APPROVAL: 'Aprobación', SIGNATURE: 'Firma', ACTIVE: 'Activo',
  RENEWAL_DUE: 'Renovación pendiente', TERMINATION: 'Terminación', CLOSED: 'Cerrado', CANCELLED: 'Cancelado',
};
const roleLabels: Record<string, string> = { LANDLORD: 'Arrendador', TENANT: 'Arrendatario', GUARANTOR: 'Obligado solidario', REQUESTING_PARTY: 'Solicitante', COMPLEMENTARY_PARTY: 'Complementaria' };

@Injectable()
export class MatterInsightsService {
  constructor(private readonly matters: MattersService, private readonly ai: InsightAiService) {}

  async analyze(user: AuthenticatedUser, id: string, kind: 'summary' | 'consistency', options: InsightOptions = {}): Promise<InsightResult> {
    const mode = options.mode ?? 'local';
    if (!['local', 'ai'].includes(mode)) throw new BadRequestException('Selecciona análisis local o con IA.');
    const matter = await this.matters.get(user, id);
    const { sources, limitations } = this.sources(matter, kind);
    const local = kind === 'summary' ? this.summary(matter) : this.consistency(matter);
    const result = mode === 'ai' ? await this.ai.generate(user, {
      kind, sources, localResult: local, conversationId: options.conversationId,
    }) : local;
    return {
      ...result, kind, mode, generatedAt: new Date().toISOString(),
      sources: sources.map(({ id: sourceId, label }) => ({ id: sourceId, label })),
      limitations: [...limitations, ...(mode === 'ai' ? ['La interpretación con IA es una propuesta para revisión; no modifica las comprobaciones ni el semáforo del sistema.'] : ['Resultado calculado mediante reglas locales, sin llamadas al proveedor de IA.']),
        ...(kind === 'consistency' ? ['Se revisan los datos registrados y los campos confirmados; no se verifica la autenticidad documental ni se emite un dictamen jurídico.'] : [])],
      facts: { reference: matter.reference, status: matter.status, readiness: matter.readiness, consistency: matter.consistency,
        documents: matter.documents.length, tasks: matter.tasks.length, parties: matter.parties.length },
    };
  }

  private summary(m: Matter): InsightAiResult {
    const source = (name: string) => `${name}:${m.id}`;
    const pending = m.checklistItems.filter((item) => item.status === 'PENDING');
    const openTasks = m.tasks.filter((task) => !['DONE', 'CANCELLED'].includes(task.status));
    const blocked = openTasks.filter((task) => task.status === 'BLOCKED');
    const currentDocuments = m.documents.filter((doc) => doc.isCurrentVersion && !doc.invalidatedAt);
    const items: Item[] = [
      { title: 'Estado y responsable', detail: `${statusLabels[m.status] ?? m.status}. Responsable: ${m.responsible?.user.displayName ?? 'Sin asignar'}.`, severity: 'info', sourceIds: [source('matter')] },
      { title: 'Partes del expediente', detail: m.parties.length ? m.parties.slice(0, 8).map((party) => `${roleLabels[party.role] ?? party.role}: ${party.person.legalName}`).join('; ') + (m.parties.length > 8 ? `; y ${m.parties.length - 8} participantes adicionales.` : '.') : 'No hay partes registradas.', severity: m.parties.length ? 'info' : 'warning', sourceIds: [source('parties')] },
      { title: 'Inmueble', detail: m.property?.displayName ?? 'Sin inmueble registrado.', severity: m.property ? 'info' : 'warning', sourceIds: [source('matter')] },
      { title: 'Requisitos', detail: `${pending.length} pendientes de ${m.checklistItems.length}; ${pending.filter((item) => item.blocking).length} bloqueantes. ${pending.slice(0, 8).map((item) => item.label).join('; ')}`, severity: pending.some((item) => item.blocking) ? 'high' : pending.length ? 'warning' : 'info', sourceIds: [source('checklist')] },
      { title: 'Trabajo pendiente', detail: `${openTasks.length} tareas abiertas; ${blocked.length} bloqueadas.`, severity: blocked.length ? 'warning' : 'info', sourceIds: [source('tasks')] },
      { title: 'Documentos', detail: `${currentDocuments.length} documentos operativos de ${m.documents.length} versiones registradas.`, severity: 'info', sourceIds: [source('documents')] },
      { title: 'Comprobaciones del sistema', detail: `${m.consistency.high} advertencias altas, ${m.consistency.medium} medias y ${m.consistency.low} informativas. ${m.readiness.summary}`, severity: m.consistency.high ? 'high' : m.consistency.medium ? 'warning' : 'info', sourceIds: [source('warnings')] },
    ];
    if (m.leaseTerms) items.splice(3, 0, {
      title: 'Condiciones del arrendamiento', detail: `Renta: ${m.leaseTerms.rentAmount.toString()} ${m.leaseTerms.currency}. Vigencia: ${date(m.leaseTerms.startDate)} a ${date(m.leaseTerms.endDate)}; ${m.leaseTerms.durationMonths} meses.`, severity: 'info', sourceIds: [source('terms')],
    });
    return { title: `Resumen de ${m.reference}`, summary: `${m.title}. Estado: ${statusLabels[m.status] ?? m.status}. ${pending.length} requisitos y ${openTasks.length} tareas pendientes.`, items };
  }

  private consistency(m: Matter): InsightAiResult {
    const items: Item[] = m.consistency.warnings.slice(0, 40).map((warning) => ({
      title: warning.title, detail: `${warning.detail} ${warning.recommendation}`,
      severity: warning.severity === 'HIGH' ? 'high' : warning.severity === 'MEDIUM' ? 'warning' : 'info',
      sourceIds: [`warnings:${m.id}`],
    }));
    for (const document of m.documents.filter((doc) => doc.isCurrentVersion && !doc.invalidatedAt).slice(0, 10)) {
      const data = object(document.extractedData);
      const party = m.parties.find((candidate) => candidate.personId === document.personId);
      if (!data || !party) continue;
      for (const [field, label] of [['legalName', 'Nombre'], ['curp', 'CURP'], ['postalCode', 'Código postal']] as const) {
        const fromDocument = data[field];
        const fromPerson = party.person[field];
        if (typeof fromDocument === 'string' && typeof fromPerson === 'string' && fromDocument.trim() && fromPerson.trim()
          && normalize(fromDocument) !== normalize(fromPerson)) items.push({
          title: `${label} diferente entre documento y ficha`,
          detail: `El campo confirmado de «${document.originalName}» difiere de la ficha de ${party.person.legalName}. Compara ambas fuentes antes de corregir algún dato.`,
          severity: field === 'curp' ? 'high' : 'warning', sourceIds: [`document:${document.id}`, `parties:${m.id}`],
        });
      }
    }
    return {
      title: `Revisión de consistencia de ${m.reference}`,
      summary: items.length ? `${m.consistency.total} advertencias de reglas y ${Math.max(0, items.length - Math.min(40, m.consistency.total))} diferencias adicionales en los campos confirmados revisados.` : 'No se detectaron inconsistencias con las reglas y los campos confirmados revisados.',
      items: items.slice(0, 40),
    };
  }

  private sources(m: Matter, kind: 'summary' | 'consistency') {
    const sources: InsightSource[] = [];
    const limitations: string[] = [];
    let total = 0;
    const add = (id: string, label: string, value: unknown) => {
      let text = JSON.stringify(value);
      const max = Math.min(2000, 40_000 - total);
      if (text.length > max) { text = text.slice(0, max); limitations.push(`La fuente «${label}» se ha limitado para este análisis.`); }
      if (!text || sources.length >= 20) return;
      total += text.length;
      sources.push({ id, label: label.slice(0, 200), text });
    };
    add(`matter:${m.id}`, 'Ficha del expediente', {
      reference: m.reference, title: m.title, kind: m.kind, status: m.status,
      responsible: m.responsible?.user.displayName ?? null,
      property: m.property ? { name: m.property.displayName, address: m.property.addressLine1, city: m.property.city, state: m.property.state } : null,
      counts: { parties: m.parties.length, documents: m.documents.length, tasks: m.tasks.length },
    });
    add(`parties:${m.id}`, 'Participantes y datos de ficha', { total: m.parties.length, participants: m.parties.slice(0, 8).map((p) => ({ role: p.role, name: p.person.legalName, ...(kind === 'consistency' ? { curp: p.person.curp, postalCode: p.person.postalCode } : {}) })) });
    add(`checklist:${m.id}`, 'Checklist del expediente', { total: m.checklistItems.length, pending: m.checklistItems.filter((x) => x.status === 'PENDING').length, pendingBlocking: m.checklistItems.filter((x) => x.status === 'PENDING' && x.blocking).length, requirements: m.checklistItems.slice(0, 30).map((x) => ({ label: x.label, status: x.status, blocking: x.blocking })) });
    add(`tasks:${m.id}`, 'Tareas registradas', { total: m.tasks.length, open: m.tasks.filter((x) => !['DONE', 'CANCELLED'].includes(x.status)).length, blocked: m.tasks.filter((x) => x.status === 'BLOCKED').length, tasks: m.tasks.slice(0, 20).map((x) => ({ title: x.title, status: x.status, dueAt: x.dueAt, priority: x.priority })) });
    add(`documents:${m.id}`, 'Inventario documental', { total: m.documents.length, operational: m.documents.filter((x) => x.isCurrentVersion && !x.invalidatedAt).length, documents: m.documents.slice(0, 20).map((d) => ({ name: d.originalName, type: d.type, version: d.version, current: d.isCurrentVersion, invalidated: Boolean(d.invalidatedAt), expiresAt: d.expiresAt })) });
    add(`warnings:${m.id}`, 'Reglas de consistencia y semáforo', { ...m.consistency, warnings: m.consistency.warnings.slice(0, 40), readiness: m.readiness });
    if (m.leaseTerms || m.mediationTerms) add(`terms:${m.id}`, 'Condiciones registradas', { lease: m.leaseTerms ? { rentAmount: m.leaseTerms.rentAmount.toString(), currency: m.leaseTerms.currency, startDate: m.leaseTerms.startDate, endDate: m.leaseTerms.endDate, durationMonths: m.leaseTerms.durationMonths, depositAmount: m.leaseTerms.depositAmount?.toString(), prepaidRentAmount: m.leaseTerms.prepaidRentAmount?.toString(), totalInitialPayment: m.leaseTerms.totalInitialPayment?.toString() } : null, mediation: m.mediationTerms ? { hearingAt: m.mediationTerms.hearingAt, centerName: m.mediationTerms.centerName } : null });
    if (kind === 'consistency') for (const d of m.documents.filter((doc) => doc.isCurrentVersion && !doc.invalidatedAt).slice(0, 10)) add(`document:${d.id}`, d.originalName, { name: d.originalName, type: d.type, confirmedFields: selectedFields(d.extractedData), personName: m.parties.find((p) => p.personId === d.personId)?.person.legalName ?? null });
    if (m.notes) add(`notes:${m.id}`, 'Notas del expediente', m.notes.slice(0, 4000));
    if (m.parties.length > 8 || m.documents.length > 20 || m.tasks.length > 20 || m.checklistItems.length > 30 || m.consistency.total > 40) limitations.push('Los totales incluyen todos los registros; el detalle de fuentes es una selección limitada de participantes, documentos, tareas, requisitos y advertencias.');
    if (kind === 'consistency') limitations.push('Se comparan como máximo los primeros diez documentos operativos con campos confirmados.');
    return { sources, limitations };
  }
}

function date(value: Date) { return value.toISOString().slice(0, 10); }
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function selectedFields(value: unknown) {
  const data = object(value);
  return data ? Object.fromEntries(['legalName', 'curp', 'postalCode', 'addressLine1', 'city', 'state'].filter((key) => typeof data[key] === 'string').map((key) => [key, String(data[key]).slice(0, 300)])) : null;
}
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
