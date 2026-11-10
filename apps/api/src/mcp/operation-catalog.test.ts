import { describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasPermission } from '@despacho/domain';
import { AdministrationController } from '../administration/administration.controller';
import { AuditController } from '../audit/audit.controller';
import { AuthController } from '../auth/auth.controller';
import { ClausesController } from '../clauses/clauses.controller';
import { DirectoryController } from '../directory/directory.controller';
import { DocumentsController } from '../documents/documents.controller';
import { HealthController } from '../health.controller';
import { InsightsController } from '../insights/insights.controller';
import { LaunchController } from '../launch/launch.controller';
import { MattersController } from '../matters/matters.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { PilotController } from '../pilot/pilot.controller';
import { PortalController } from '../portal/portal.controller';
import { ReportsController } from '../reports/reports.controller';
import { RequirementsController } from '../requirements/requirements.controller';
import { SearchController } from '../search/search.controller';
import { TasksController } from '../tasks/tasks.controller';
import { isSafeAssistantTool } from '../assistant/assistant-mcp.service';
import { rankMcpTools, toolRequiresConfirmation } from '../assistant/assistant.service';
import { buildMcpOperationCatalog } from './operation-catalog';

const catalog = buildMcpOperationCatalog([
  { metatype: AdministrationController },
  { metatype: AuditController },
  { metatype: AuthController },
  { metatype: ClausesController },
  { metatype: DirectoryController },
  { metatype: DocumentsController },
  { metatype: HealthController },
  { metatype: InsightsController },
  { metatype: LaunchController },
  { metatype: MattersController },
  { metatype: NotificationsController },
  { metatype: PilotController },
  { metatype: PortalController },
  { metatype: ReportsController },
  { metatype: RequirementsController },
  { metatype: SearchController },
  { metatype: TasksController },
]);
const embeddedAssistantTools = catalog.map((operation): Tool => ({
  name: operation.name,
  title: operation.title,
  description: operation.description,
  inputSchema: operation.inputSchema as Tool['inputSchema'],
  annotations: operation.annotations,
})).filter(isSafeAssistantTool);

describe('MCP operation catalog', () => {
  it('reserva toda operación de piloto y lanzamiento para administración, incluida la lectura', () => {
    for (const controllerName of ['PilotController', 'LaunchController']) {
      const operations = catalog.filter((operation) => operation.controllerName === controllerName);
      expect(operations.length).toBeGreaterThan(0);
      for (const operation of operations) {
        expect(operation.permissions.length, operation.name).toBeGreaterThan(0);
        expect(operation.permissions.every((permission) => hasPermission('ADMIN', permission)), operation.name).toBe(true);
        for (const role of ['LAWYER', 'OPERATOR', 'VIEWER'] as const) {
          expect(operation.permissions.every((permission) => hasPermission(role, permission)), `${role}: ${operation.name}`).toBe(false);
        }
      }
    }
  });

  it('expone el borrado confirmado como una acción destructiva con permiso documental', () => {
    const remove = catalog.find((operation) => operation.name === 'despacho_documents_remove');
    expect(remove).toMatchObject({
      method: 'DELETE', apiPath: 'documents/:id', permissions: ['DOCUMENT_WRITE'],
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: {
        properties: { body: { properties: {
          reason: { type: 'string', minLength: 10, maxLength: 1000 },
          confirmation: { type: 'string' },
        }, required: expect.arrayContaining(['reason', 'confirmation']) } },
        required: expect.arrayContaining(['params', 'body']),
      },
    });
  });

  it('expone el resumen de tareas pendientes sin filtros obligatorios y lo selecciona para la demo', () => {
    const summary = catalog.find((operation) => operation.name === 'despacho_tasks_pending_summary');
    expect(summary).toMatchObject({
      method: 'GET', apiPath: 'tasks/pending-summary', permissions: ['TASK_READ'],
      annotations: { readOnlyHint: true },
    });
    expect(summary?.inputSchema.required ?? []).toEqual([]);
    expect(rankMcpTools('Muéstrame mis tareas pendientes', embeddedAssistantTools, 24)
      .map((tool) => tool.name)).toContain('despacho_tasks_pending_summary');
  });
  it('covers every application operation except health and credential lifecycle', () => {
    expect(catalog).toHaveLength(134);
    expect(new Set(catalog.map((operation) => operation.name)).size).toBe(catalog.length);
    expect(catalog.some((operation) => operation.name === 'despacho_auth_me')).toBe(true);
    expect(catalog.some((operation) => operation.handlerName === 'login')).toBe(false);
    expect(catalog.some((operation) => operation.controllerName === 'HealthController')).toBe(false);
    expect(catalog.some((operation) => operation.name === 'despacho_portal_public_view')).toBe(true);
  });

  it('publica análisis locales por defecto y reserva IA para solicitudes expresas', () => {
    for (const action of ['summary', 'consistency', 'compare', 'classify']) {
      const operation = catalog.find((candidate) => candidate.name === `despacho_insights_${action}`);
      expect(operation?.description).toMatch(/local por defecto/);
      expect(operation?.description).toMatch(/expres|petición expresa/);
      expect(operation?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true });
      expect(operation?.inputSchema).toMatchObject({ properties: { body: { properties: { mode: { enum: ['local', 'ai'] } } } } });
    }
  });

  it('publishes exact path, DTO and local-file inputs', () => {
    const upload = catalog.find((operation) => operation.name === 'despacho_documents_upload');
    expect(upload).toMatchObject({
      method: 'POST',
      apiPath: 'matters/:matterId/documents',
      acceptsFiles: true,
      multipleFiles: false,
      permissions: ['DOCUMENT_WRITE'],
    });
    expect(upload?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        params: { required: ['matterId'] },
        body: { required: ['type'] },
        files: { minItems: 1, maxItems: 1 },
      },
      required: ['params', 'body', 'files'],
    });

    const search = catalog.find((operation) => operation.name === 'despacho_search_search');
    expect(search?.inputSchema).toMatchObject({
      properties: { query: { required: ['q'] } },
      required: ['query'],
    });

    const createPerson = catalog.find((operation) => (
      operation.name === 'despacho_directory_create_person'
    ));
    expect(createPerson?.description).toMatch(/cliente o contacto/);
    expect(createPerson?.inputSchema).toMatchObject({
      properties: {
        body: {
          properties: {
            type: { enum: expect.arrayContaining(['INDIVIDUAL', 'COMPANY']) },
            legalName: { type: 'string' },
            occupation: { type: 'string' },
            phone: { type: 'string' },
          },
          required: expect.arrayContaining(['type', 'legalName']),
        },
      },
      required: ['body'],
    });

    const listPeople = catalog.find((operation) => (
      operation.name === 'despacho_directory_list_people'
    ));
    const updatePerson = catalog.find((operation) => (
      operation.name === 'despacho_directory_update_person'
    ));
    expect(listPeople?.description).toMatch(/resultados extensos/);
    expect(updatePerson?.description).toMatch(/información proporcionados|campos proporcionados/);
    expect(updatePerson?.description).toContain('YYYY-MM-DD');
    const searchPeople = catalog.find((operation) => (
      operation.name === 'despacho_search_search'
    ));
    expect(searchPeople?.description).toMatch(/localizar una persona/);
  });

  it('marks reads and consequential changes accurately', () => {
    const list = catalog.find((operation) => operation.name === 'despacho_matters_list');
    const cancel = catalog.find((operation) => operation.name === 'despacho_matters_cancel');
    const download = catalog.find((operation) => operation.name === 'despacho_documents_download');
    expect(list?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(cancel?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(download?.annotations.readOnlyHint).toBe(false);
    expect(download?.returnsFile).toBe(true);
    expect(list?.inputSchema).toMatchObject({
      properties: {
        query: {
          properties: {
            status: { enum: expect.arrayContaining(['ACTIVE', 'CLOSED']) },
            kind: { enum: expect.arrayContaining(['LEASE', 'MEDIATION_AGREEMENT']) },
          },
        },
      },
    });
  });

  it('ofrece los enlaces de descarga como metadatos de consulta seguros para el chat', () => {
    const operation = catalog.find((candidate) => candidate.name === 'despacho_documents_download_link');
    expect(operation).toMatchObject({
      method: 'GET', apiPath: 'documents/:id/download-link', permissions: ['DOCUMENT_READ'],
      returnsFile: false,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    });
    expect(operation?.inputSchema).toMatchObject({ properties: { params: { required: ['id'] } } });
    expect(operation?.inputSchema.properties).not.toHaveProperty('outputPath');
    const tool = embeddedAssistantTools.find((candidate) => candidate.name === operation?.name)!;
    expect(tool).toBeDefined();
    expect(toolRequiresConfirmation(tool)).toBe(false);
    expect(rankMcpTools('descarga el contrato en Word', embeddedAssistantTools, 16)
      .map((candidate) => candidate.name)).toContain(tool.name);
  });

  it.each(['lease_draft', 'agreement_draft', 'pdf_preview'])(
    'exige confirmación antes de generar %s desde el catálogo real',
    (action) => {
      const tool = embeddedAssistantTools.find((candidate) => (
        candidate.name === `despacho_documents_generate_${action}`
      ))!;
      expect(tool).toBeDefined();
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
      expect(toolRequiresConfirmation(tool)).toBe(true);
    },
  );

  it('allows every safe write operation to be discovered from its visible title', () => {
    const safeWrites = embeddedAssistantTools.filter((tool) => (
      tool.annotations?.readOnlyHint !== true
    ));
    const undiscoverable = safeWrites.filter((tool) => (
      !rankMcpTools(tool.title ?? tool.name, embeddedAssistantTools, 16)
        .some((candidate) => candidate.name === tool.name)
    ));

    expect(safeWrites.length).toBeGreaterThan(50);
    expect(undiscoverable.map((tool) => tool.name)).toEqual([]);
  });
});
