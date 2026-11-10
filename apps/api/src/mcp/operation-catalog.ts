import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { validationMetadatasToSchemas } from 'class-validator-jsonschema';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/permissions.decorator';
import type { Permission } from '@despacho/domain';

type JsonSchema = Record<string, unknown>;

interface ControllerWrapper {
  metatype?: Function | Type<unknown> | null;
}

interface RouteArgumentMetadata {
  index: number;
  data?: string;
}

export interface McpOperation {
  name: string;
  title: string;
  description: string;
  controllerName: string;
  handlerName: string;
  method: string;
  apiPath: string;
  permissions: Permission[];
  inputSchema: JsonSchema;
  acceptsFiles: boolean;
  multipleFiles: boolean;
  returnsFile: boolean;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
    idempotentHint: boolean;
  };
}

const DOMAIN_LABELS: Record<string, string> = {
  AdministrationController: 'Equipo',
  AuditController: 'Auditoría',
  AuthController: 'Cuenta',
  ClausesController: 'Cláusulas',
  DirectoryController: 'Directorio',
  DocumentsController: 'Documentos',
  InsightsController: 'Análisis',
  LaunchController: 'Lanzamiento',
  MattersController: 'Expedientes',
  NotificationsController: 'Avisos',
  PilotController: 'Piloto',
  PortalController: 'Portal',
  ReportsController: 'Reportes',
  RequirementsController: 'Requisitos',
  SearchController: 'Búsqueda',
  TasksController: 'Tareas',
};

const WORDS: Record<string, string> = {
  acknowledge: 'reconocer',
  add: 'agregar',
  approval: 'aprobación',
  approve: 'aprobar',
  assign: 'asignar',
  assignees: 'responsables',
  batch: 'lote',
  cancel: 'cancelar',
  capture: 'capturar',
  change: 'cambiar',
  checkpoint: 'checkpoint',
  checkpoints: 'checkpoints',
  classification: 'clasificación',
  clause: 'cláusula',
  clauses: 'cláusulas',
  comment: 'comentario',
  compare: 'comparar',
  classify: 'clasificar',
  consistency: 'inconsistencias',
  complete: 'completar',
  confirm: 'confirmar',
  control: 'control',
  create: 'crear',
  csv: 'CSV',
  dashboard: 'tablero',
  decide: 'registrar decisión',
  dependency: 'prerrequisito',
  document: 'documento',
  draft: 'borrador',
  download: 'descargar',
  evidence: 'evidencia',
  export: 'exportar',
  extract: 'extraer',
  extraction: 'extracción',
  final: 'final',
  generate: 'generar',
  get: 'consultar',
  inbox: 'bandeja',
  integration: 'integración',
  invalidate: 'invalidar',
  invitation: 'invitación',
  issue: 'incidencia',
  legal: 'jurídica',
  lease: 'arrendamiento',
  agreement: 'convenio',
  link: 'enlace',
  list: 'listar',
  manual: 'manual',
  matter: 'expediente',
  mediation: 'mediación',
  member: 'integrante',
  metrics: 'métricas',
  operations: 'operación',
  party: 'parte',
  pdf: 'PDF',
  person: 'persona',
  preview: 'vista previa',
  program: 'programa',
  property: 'inmueble',
  queue: 'bandeja',
  readiness: 'preparación',
  reject: 'rechazar',
  remove: 'retirar',
  renewal: 'renovación',
  reopen: 'reabrir',
  report: 'reporte',
  reschedule: 'reprogramar',
  responsible: 'responsable',
  restore: 'restaurar',
  review: 'revisar',
  role: 'rol',
  run: 'ejecutar',
  search: 'buscar',
  select: 'seleccionar',
  set: 'establecer',
  signature: 'firma',
  settings: 'configuración',
  sla: 'SLA',
  start: 'iniciar',
  status: 'estado',
  summary: 'resumen',
  submission: 'captura',
  submit: 'enviar',
  sync: 'sincronizar',
  task: 'tarea',
  terms: 'condiciones',
  termination: 'terminación',
  training: 'capacitación',
  transition: 'cambiar estado',
  update: 'actualizar',
  upload: 'cargar',
  validity: 'vigencia',
  validation: 'validación',
  version: 'versión',
  waive: 'dispensar',
};

const DESTRUCTIVE_ACTION = /(cancel|delete|invalidate|remove|revoke|commit|decide|completeTermination|finalApprove|approveVersion|acceptSubmission|rejectSubmission)/i;
const FILE_RESPONSE = /(download|preview|exportCsv|Csv$)/i;
const OPERATION_GUIDANCE: Record<string, string> = {
  'InsightsController.summary':
    'Resume los datos registrados del expediente con fuentes. Usa body.mode local por defecto, sin llamadas a IA. Usa ai sólo cuando el usuario pida expresamente un resumen con IA; genera consumo. No modifica el expediente.',
  'InsightsController.consistency':
    'Revisa advertencias y diferencias entre datos confirmados del expediente. Usa body.mode local por defecto. Usa ai sólo cuando el usuario solicite expresamente interpretación con IA; genera consumo. No cambia el semáforo ni determina autenticidad o validez jurídica.',
  'InsightsController.compare':
    'Explica las diferencias de texto con el borrador DOCX anterior. Usa body.mode local por defecto. Usa ai sólo a petición expresa del usuario; genera consumo. El diff exacto sigue siendo la referencia y no se modifican documentos.',
  'InsightsController.classify':
    'Propone un tipo documental a partir de texto guardado o lectura local. Usa body.mode local por defecto. Usa ai sólo a petición expresa del usuario; genera consumo. La sugerencia requiere revisión y no guarda cambios ni infiere el papel de una persona.',
  'DocumentsController.extract':
    'Lee un documento para revisión humana. Usa body.mode local por defecto: texto PDF u OCR local, sin proveedor de IA. Usa ai sólo cuando el usuario pida expresamente lectura con IA; manual abre captura humana. No cambies a IA si falla la lectura local.',
  'DocumentsController.downloadLink':
    'Obtiene el nombre y el enlace autenticado de descarga de un documento existente. Devuelve metadatos JSON, sin guardar archivos en el servidor. Busca primero el documento y usa su ID real. No genera otra versión ni requiere confirmación de escritura.',
  'DocumentsController.generateLeaseDraft':
    'Genera y guarda una nueva versión del borrador Word del contrato de arrendamiento usando la plantilla del despacho. Es una escritura y requiere confirmación previa. El resultado identifica el archivo para descargarlo desde el chat.',
  'DocumentsController.generateAgreementDraft':
    'Genera y guarda una nueva versión del borrador Word del convenio de mediación usando la plantilla del despacho y el arrendamiento vinculado. Es una escritura y requiere confirmación previa. El resultado identifica el archivo para descargarlo desde el chat.',
  'DocumentsController.remove':
    'Elimina definitivamente un archivo cargado y sus extracciones. No revierte datos aplicados al Directorio. Requiere motivo y confirmación explícita ELIMINAR. No permite borrar contratos controlados, archivos del portal ni evidencias vinculadas. Para conservar el archivo pero retirarlo del checklist, usa Invalidar.',
  'DirectoryController.createPerson':
    'Crea y guarda una persona física o moral en el Directorio; úsala también para agregar, dar de alta o registrar un cliente o contacto. Omite los campos opcionales desconocidos y nunca envíes cadenas vacías ni datos de relleno inventados.',
  'DirectoryController.listPeople':
    'Devuelve todas las personas o clientes con sus identificadores. Si conoces el nombre, usa preferentemente la búsqueda global para evitar resultados extensos.',
  'DirectoryController.updatePerson':
    'Completa, corrige o actualiza la ficha de una persona o cliente existente. Obtén primero el ID mediante la búsqueda global por nombre y envía únicamente los campos proporcionados. Usa birthDate en formato ISO YYYY-MM-DD.',
  'SearchController.search':
    'Busca personas, expedientes, inmuebles y documentos por nombre o referencia y devuelve sus identificadores. Úsala para localizar una persona antes de actualizar su ficha.',
};

export function buildMcpOperationCatalog(wrappers: ControllerWrapper[]): McpOperation[] {
  const schemas = createDtoSchemas();
  const operations = wrappers.flatMap((wrapper) =>
    wrapper.metatype && wrapper.metatype.prototype
      ? buildControllerOperations(wrapper.metatype as Type<unknown>, schemas)
      : [],
  );
  return operations.sort((left, right) => left.name.localeCompare(right.name));
}

export function buildControllerOperations(
  controllerType: Type<unknown>,
  schemas = createDtoSchemas(),
): McpOperation[] {
  const controllerName = controllerType.name;
  if (
    controllerName === 'HealthController'
    || controllerName === 'McpController'
    || controllerName === 'AssistantController'
    || controllerName === 'AiUsageController'
  ) return [];

  const controllerPath = firstPath(Reflect.getMetadata(PATH_METADATA, controllerType));
  const prototype = controllerType.prototype as Record<string, unknown>;
  const operations: McpOperation[] = [];

  for (const handlerName of Object.getOwnPropertyNames(prototype)) {
    if (handlerName === 'constructor') continue;
    if (controllerName === 'AuthController' && handlerName !== 'me') continue;

    const handler = prototype[handlerName];
    if (typeof handler !== 'function') continue;
    const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (requestMethod === undefined) continue;

    const handlerPath = firstPath(Reflect.getMetadata(PATH_METADATA, handler));
    const apiPath = joinPaths(controllerPath, handlerPath);
    const permissions = (
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler) ??
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controllerType) ??
      []
    ) as Permission[];
    const routeArgs = (
      Reflect.getMetadata(ROUTE_ARGS_METADATA, controllerType, handlerName) ?? {}
    ) as Record<string, RouteArgumentMetadata>;
    const parameterTypes = (
      Reflect.getMetadata('design:paramtypes', prototype, handlerName) ?? []
    ) as Type<unknown>[];
    const bodyArgument = findArgument(routeArgs, 3);
    const queryArgument = findArgument(routeArgs, 4);
    const hasSingleFile = Boolean(findArgument(routeArgs, 8));
    const hasMultipleFiles = Boolean(findArgument(routeArgs, 9));
    const acceptsFiles = hasSingleFile || hasMultipleFiles;
    const method = RequestMethod[requestMethod];
    const returnsFile = method === 'GET' && handlerName !== 'downloadLink'
      && (FILE_RESPONSE.test(handlerName) || /(?:\.csv|\/download|\/preview)$/.test(apiPath));
    const domain = DOMAIN_LABELS[controllerName] ?? controllerName.replace(/Controller$/, '');
    const action = humanizeAction(handlerName);
    const inputSchema = createInputSchema({
      apiPath,
      bodyType: bodyArgument ? parameterTypes[bodyArgument.index] : undefined,
      queryType: queryArgument ? parameterTypes[queryArgument.index] : undefined,
      acceptsFiles,
      multipleFiles: hasMultipleFiles,
      returnsFile,
      schemas,
    });

    const guidance = OPERATION_GUIDANCE[`${controllerName}.${handlerName}`];
    operations.push({
      name: `despacho_${toSnakeCase(controllerName.replace(/Controller$/, ''))}_${toSnakeCase(handlerName)}`,
      title: `${domain}: ${action}`,
      description: [createDescription({
        action,
        method,
        apiPath,
        permissions,
        acceptsFiles,
        returnsFile,
        destructive: DESTRUCTIVE_ACTION.test(handlerName) || method === 'DELETE',
      }), guidance].filter(Boolean).join(' '),
      controllerName,
      handlerName,
      method,
      apiPath,
      permissions,
      inputSchema,
      acceptsFiles,
      multipleFiles: hasMultipleFiles,
      returnsFile,
      annotations: {
        readOnlyHint: (method === 'GET' && !returnsFile) || controllerName === 'InsightsController',
        destructiveHint: DESTRUCTIVE_ACTION.test(handlerName) || method === 'DELETE',
        openWorldHint: controllerName === 'InsightsController' && method === 'POST',
        idempotentHint: method === 'GET',
      },
    });
  }

  return operations;
}

function createDtoSchemas(): Record<string, JsonSchema> {
  // class-transformer no publica este almacenamiento en su entrada principal.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { defaultMetadataStorage } = require('class-transformer/cjs/storage') as {
    defaultMetadataStorage: unknown;
  };
  return validationMetadatasToSchemas({
    classTransformerMetadataStorage: defaultMetadataStorage as never,
    refPointerPrefix: '#/definitions/',
  }) as Record<string, JsonSchema>;
}

function createInputSchema(options: {
  apiPath: string;
  bodyType?: Type<unknown>;
  queryType?: Type<unknown>;
  acceptsFiles: boolean;
  multipleFiles: boolean;
  returnsFile: boolean;
  schemas: Record<string, JsonSchema>;
}): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const pathParameters = [...options.apiPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);

  if (pathParameters.length > 0) {
    properties.params = {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(pathParameters.map((name) => [name, {
        type: 'string',
        minLength: 1,
        description: `Valor del parámetro de ruta ${name}.`,
      }])),
      required: pathParameters,
    };
    required.push('params');
  }

  if (options.queryType) {
    const querySchema = schemaForType(options.queryType, options.schemas);
    properties.query = querySchema;
    if (Array.isArray(querySchema.required) && querySchema.required.length > 0) required.push('query');
  }

  if (options.bodyType) {
    properties.body = schemaForType(options.bodyType, options.schemas);
    required.push('body');
  }

  if (options.acceptsFiles) {
    properties.files = {
      type: 'array',
      minItems: 1,
      maxItems: options.multipleFiles ? 10 : 1,
      description: 'Archivos locales que se enviarán a la aplicación.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            minLength: 1,
            description: 'Ruta absoluta o relativa del archivo local.',
          },
          field: {
            type: 'string',
            description: `Campo multipart; por defecto ${options.multipleFiles ? 'files' : 'file'}.`,
          },
          mimeType: {
            type: 'string',
            description: 'Tipo MIME opcional. Si se omite se usa application/octet-stream.',
          },
        },
        required: ['path'],
      },
    };
    required.push('files');
  }

  if (options.returnsFile) {
    properties.outputPath = {
      type: 'string',
      description: 'Ruta local opcional donde guardar la descarga. Si se omite se usa tmp/mcp-downloads.',
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function schemaForType(type: Type<unknown>, schemas: Record<string, JsonSchema>): JsonSchema {
  if (type === String) return { type: 'string' };
  if (type === Number) return { type: 'number' };
  if (type === Boolean) return { type: 'boolean' };
  const schema = schemas[type.name];
  if (!schema) return { type: 'object', additionalProperties: true };
  return inlineReferences(schema, schemas, new Set([type.name]), true);
}

function inlineReferences(
  value: unknown,
  schemas: Record<string, JsonSchema>,
  seen: Set<string>,
  root = false,
): JsonSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value as JsonSchema;
  const record = value as Record<string, unknown>;
  const reference = typeof record.$ref === 'string' ? record.$ref : undefined;
  if (reference) {
    const name = reference.split('/').at(-1);
    if (!name || seen.has(name) || !schemas[name]) return { type: 'object', additionalProperties: true };
    return inlineReferences(schemas[name], schemas, new Set([...seen, name]), true);
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (Array.isArray(child)) {
      result[key] = child.map((item) =>
        item && typeof item === 'object' ? inlineReferences(item, schemas, seen) : item,
      );
    } else if (child && typeof child === 'object') {
      result[key] = inlineReferences(child, schemas, seen);
    } else {
      result[key] = child;
    }
  }
  if (root && result.type === 'object') result.additionalProperties = false;
  return result;
}

function findArgument(
  routeArgs: Record<string, RouteArgumentMetadata>,
  routeParamType: number,
): RouteArgumentMetadata | undefined {
  const entry = Object.entries(routeArgs).find(([key]) => Number(key.split(':')[0]) === routeParamType);
  return entry?.[1];
}

function createDescription(options: {
  action: string;
  method: string;
  apiPath: string;
  permissions: Permission[];
  acceptsFiles: boolean;
  returnsFile: boolean;
  destructive: boolean;
}) {
  const details = [
    `${capitalize(options.action)} en Tabelio.`,
    `Opera mediante ${options.method} /api/${options.apiPath}.`,
    options.permissions.length > 0
      ? `Respeta los permisos ${options.permissions.join(', ')} del usuario conectado y el aislamiento de su organización.`
      : 'La operación de destino no exige un permiso adicional, pero la conexión MCP sí requiere una sesión individual.',
  ];
  if (options.acceptsFiles) details.push('Lee los archivos locales indicados y los envía como multipart/form-data; usa únicamente rutas autorizadas expresamente por la persona.');
  if (options.returnsFile) details.push('Guarda la respuesta en outputPath o en el directorio local de descargas MCP.');
  if (options.destructive) details.push('Puede producir un cambio difícil de revertir; confirma la intención y los identificadores antes de llamarla.');
  return details.join(' ');
}

function humanizeAction(value: string) {
  const words = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/);
  return words.map((word) => WORDS[word] ?? word).join(' ');
}

function firstPath(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function joinPaths(...parts: string[]) {
  return parts.join('/').replace(/\/+/, '/').replace(/^\/+|\/+$/g, '');
}

function toSnakeCase(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
