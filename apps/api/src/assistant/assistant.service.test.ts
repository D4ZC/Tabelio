import { MembershipRole } from '@despacho/database';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AssistantMcpService } from './assistant-mcp.service';
import {
  AssistantProviderService,
  type AssistantProviderResponse,
} from './assistant-provider.service';
import {
  AssistantService,
  assistantToolDescription,
  compactToolResult,
  isSafeApplicationPath,
  isAdminApplicationPath,
  rankMcpTools,
  selectDiscoveredMcpTools,
  toolRequiresConfirmation,
} from './assistant.service';
import { isSafeAssistantTool } from './assistant-mcp.service';

describe('políticas del asistente', () => {
  it('selecciona herramientas relacionadas con la solicitud', () => {
    const tools = [
      tool('despacho_documents_list', 'Documentos: listar', true),
      tool('despacho_tasks_list', 'Tareas: listar pendientes', true),
      tool('despacho_matters_create', 'Expedientes: crear', false),
    ];

    expect(rankMcpTools('muéstrame mis tareas pendientes', tools, 1)[0].name)
      .toBe('despacho_tasks_list');
  });

  it('relaciona contratos activos con la lista de expedientes desde cualquier pantalla', () => {
    const tools = [
      tool('despacho_clauses_list', 'Cláusulas: listar', true),
      tool('despacho_matters_dashboard', 'Expedientes: tablero', true),
      tool('despacho_matters_list', 'Expedientes: listar', true),
      tool('despacho_matters_lease_terms', 'Expedientes: condiciones de arrendamiento', false),
    ];

    const ranked = rankMcpTools('¿Cuáles contratos tengo activos? /cuenta', tools, 2);

    expect(ranked.map((candidate) => candidate.name)).toContain('despacho_matters_list');
    expect(ranked[0].name).toBe('despacho_matters_list');
  });

  it('relaciona agregar un cliente con crear una persona en el Directorio', () => {
    const tools = [
      tool('despacho_directory_list_people', 'Directorio: listar persona', true),
      tool('despacho_directory_update_person', 'Directorio: actualizar persona', false),
      tool('despacho_directory_create_property', 'Directorio: crear inmueble', false),
      tool('despacho_directory_create_person', 'Directorio: crear persona', false),
    ];

    const ranked = rankMcpTools(
      'Quiero que agreges al directorio a un nuevo cliente, se llama David Zepeda',
      tools,
      2,
    );

    expect(ranked[0].name).toBe('despacho_directory_create_person');
  });

  it('relaciona información faltante con actualizar una persona existente', () => {
    const tools = [
      tool('despacho_directory_create_person', 'Directorio: crear persona', false),
      tool('despacho_directory_list_people', 'Directorio: listar persona', true),
      tool('despacho_directory_update_person', 'Directorio: actualizar persona', false),
      tool('despacho_search_search', 'Búsqueda: buscar', true),
    ];

    const ranked = rankMcpTools(
      'Agrega la información faltante a la ficha de la persona David Zepeda',
      tools,
      2,
    );

    expect(ranked.map((candidate) => candidate.name)).toEqual(expect.arrayContaining([
      'despacho_search_search',
      'despacho_directory_update_person',
    ]));
  });

  it('no llena el catálogo inicial con herramientas sin relación', () => {
    const relevant = tool('despacho_tasks_create', 'Tareas: crear', false);
    const unrelated = Array.from({ length: 40 }, (_, index) => (
      tool(`despacho_noise_${index}`, `Ruido ${index}`, true)
    ));

    const ranked = rankMcpTools('Crea una tarea', [relevant, ...unrelated], 32);

    expect(ranked.map((candidate) => candidate.name)).toContain(relevant.name);
    expect(ranked).toHaveLength(1);
  });

  it('reemplaza herramientas irrelevantes cuando una búsqueda descubre otra capacidad', () => {
    const selected = new Set(Array.from({ length: 32 }, (_, index) => `tool-${index}`));
    const discoveredTool = tool(
      'despacho_requirements_update',
      'Requisitos: actualizar',
      false,
    );

    const discovery = selectDiscoveredMcpTools(selected, [discoveredTool], 32);

    expect(selected).toHaveLength(32);
    expect(selected.has(discoveredTool.name)).toBe(true);
    expect(discovery.tools[0]).toMatchObject({
      name: discoveredTool.name,
      alreadyAvailable: false,
    });
    expect(discovery.replacedTools).toHaveLength(1);
  });

  it('describe genéricamente cada escritura como una operación real con confirmación', () => {
    const description = assistantToolDescription(tool(
      'despacho_requirements_update',
      'Requisitos: actualizar',
      false,
    ));

    expect(description).toMatch(/operación real de escritura/i);
    expect(description).toMatch(/no la sustituyas por abrir una pantalla/i);
    expect(description).toMatch(/confirmación antes de ejecutarla/i);
  });

  it('exige confirmación para cualquier escritura', () => {
    expect(toolRequiresConfirmation(tool('read', 'Consultar', true))).toBe(false);
    expect(toolRequiresConfirmation(tool('write', 'Actualizar', false))).toBe(true);
  });

  it('limita navegación a rutas internas conocidas', () => {
    expect(isSafeApplicationPath('/expedientes/matter-1')).toBe(true);
    expect(isSafeApplicationPath('/tareas?estado=OPEN')).toBe(true);
    expect(isSafeApplicationPath('/portal/token')).toBe(false);
    expect(isSafeApplicationPath('https://example.com')).toBe(false);
    expect(isSafeApplicationPath('/administracion/puesta-en-marcha')).toBe(true);
    expect(isSafeApplicationPath('/administracion/puesta-en-marcha?origen=asistente')).toBe(true);
    expect(isSafeApplicationPath('/administracion/otra-seccion')).toBe(false);
    for (const path of ['/piloto-foo', '/lanzamiento-foo', '/administracion/puesta-en-marcha-foo']) {
      expect(isSafeApplicationPath(path)).toBe(false);
      expect(isAdminApplicationPath(path)).toBe(false);
    }
    expect(isAdminApplicationPath('/piloto/operacion?origen=asistente')).toBe(true);
    expect(isAdminApplicationPath('/expedientes')).toBe(false);
  });

  it.each([
    '/administracion/puesta-en-marcha', '/piloto', '/piloto/operacion', '/lanzamiento?origen=asistente',
  ])('sólo navega a puesta en marcha cuando la identidad autenticada es administradora: %s', async (path) => {
    for (const role of [MembershipRole.ADMIN, MembershipRole.LAWYER, MembershipRole.OPERATOR, MembershipRole.VIEWER]) {
      const harness = createHarness({ responses: [
        toolResponse('open-startup', 'assistant_open_page', JSON.stringify({ path })),
        finalResponse('Solicitud de navegación revisada.'),
      ] });
      const response = await harness.service.chat(chatDto('Abre la puesta en marcha'), { ...testUser, role }, 'access-token');
      expect(response.clientActions).toEqual(role === MembershipRole.ADMIN ? [{ type: 'navigate', path }] : []);
      const feedback = String(harness.createResponse.mock.calls[1][0].input.at(-1)?.output);
      expect(feedback).toContain(role === MembershipRole.ADMIN ? '"ok":true' : 'reservada a administración');
      expect(harness.callTool).not.toHaveBeenCalled();
    }
  });

  it('oculta herramientas con rutas de archivo o portal público', () => {
    expect(isSafeAssistantTool(tool('despacho_documents_list', 'Listar', true))).toBe(true);
    expect(isSafeAssistantTool(tool(
      'despacho_documents_download',
      'Descargar',
      true,
      { outputPath: { type: 'string' } },
    ))).toBe(false);
    expect(isSafeAssistantTool(tool('despacho_portal_public_view', 'Portal', true))).toBe(false);
    expect(isSafeAssistantTool(tool('despacho_portal_create_invitation', 'Invitar', false))).toBe(false);
  });

  it('redacta secretos y recorta resultados antes de enviarlos al modelo', () => {
    const nestedPortal = compactToolResult({
      structuredContent: {
        portalUrl: 'https://app.example/portal/intake/nested-single-use-token',
      },
    });
    expect(nestedPortal).not.toContain('nested-single-use-token');
    expect(nestedPortal).toContain('/portal/[REDACTADO]');

    const compacted = compactToolResult({
      structuredContent: {
        apiKey: 'secret',
        portalUrl: 'https://app.example/portal/single-use-token',
        result: 'x'.repeat(200),
      },
      content: [{
        type: 'text',
        text: '{"apiKey":"duplicated-secret","portalUrl":"https://app.example/portal/leaked-token"}',
      }],
    }, 240);
    expect(compacted).not.toContain('secret');
    expect(compacted).not.toContain('single-use-token');
    expect(compacted).not.toContain('duplicated-secret');
    expect(compacted).not.toContain('leaked-token');
    expect(compacted).toContain('truncated');
  });
});

describe('orquestación segura del asistente', () => {
  it.each(['lease_draft', 'agreement_draft'])(
    'sólo genera %s tras confirmar y entrega la descarga aunque el modelo omita el enlace',
    async (action) => {
      const generator = tool(`despacho_documents_generate_${action}`, 'Documentos: generar borrador', false);
      const harness = createHarness({
        tools: [generator],
        responses: [
          toolResponse('generate', generator.name, JSON.stringify({
            params: { matterId: 'matter-1' }, body: { executionDate: '2026-10-09' },
          })),
          finalResponse('Se generó el borrador.'),
        ],
      });
      harness.callTool.mockResolvedValueOnce({
        structuredContent: { result: { id: 'document-2', originalName: 'Borrador v2.docx' } },
      });
      const proposal = await harness.service.chat(chatDto('Genera el borrador'), testUser, 'token');
      expect(proposal.pendingAction).toBeDefined();
      expect(proposal.changed).toBe(false);
      expect(proposal.downloads).toBeUndefined();
      expect(harness.callTool).not.toHaveBeenCalled();

      const reply = await harness.service.resolveAction(proposal.pendingAction!.id, true, testUser, 'token');
      expect(harness.callTool).toHaveBeenCalledOnce();
      expect(reply.changed).toBe(true);
      expect(reply.downloads).toEqual([{ documentId: 'document-2', fileName: 'Borrador v2.docx' }]);
      expect(harness.createResponse.mock.calls[0][0].instructions).not.toContain('La persona pulsó Confirmar');
      expect(harness.createResponse.mock.calls[1][0].instructions).toContain('La persona pulsó Confirmar');
      await expect(harness.service.resolveAction(proposal.pendingAction!.id, true, testUser, 'token'))
        .rejects.toThrow(/no existe o ya venció/);
      expect(harness.callTool).toHaveBeenCalledOnce();
    },
  );

  it('conserva la descarga de la generación confirmada si falla el resumen de IA', async () => {
    const generator = tool('despacho_documents_generate_lease_draft', 'Documentos: generar borrador', false);
    const harness = createHarness({
      tools: [generator],
      responses: [toolResponse('generate', generator.name, '{}')],
    });
    harness.createResponse.mockRejectedValueOnce(new Error('Proveedor no disponible'));
    harness.callTool.mockResolvedValueOnce({
      structuredContent: { result: { id: 'document-2', originalName: 'Contrato v2.docx' } },
    });
    const proposal = await harness.service.chat(chatDto('Genera el borrador'), testUser, 'token');
    const reply = await harness.service.resolveAction(proposal.pendingAction!.id, true, testUser, 'token');
    expect(reply.changed).toBe(true);
    expect(reply.downloads).toEqual([{ documentId: 'document-2', fileName: 'Contrato v2.docx' }]);
  });

  it('ofrece la descarga existente sin generar otra versión ni pedir confirmación de escritura', async () => {
    const download = tool('despacho_documents_download_link', 'Documentos: descargar enlace', true);
    const harness = createHarness({
      tools: [download],
      responses: [
        toolResponse('download', download.name, JSON.stringify({ params: { id: 'document-2' } })),
        finalResponse('Puedes descargar el contrato.'),
      ],
    });
    harness.callTool.mockResolvedValueOnce({
      structuredContent: { result: {
        documentId: 'document-2', fileName: 'Contrato v2.docx', downloadPath: '/documents/document-2/download',
      } },
    });
    const reply = await harness.service.chat(chatDto('Descarga el contrato'), testUser, 'token');
    expect(reply.pendingAction).toBeUndefined();
    expect(reply.changed).toBe(false);
    expect(reply.downloads).toEqual([{ documentId: 'document-2', fileName: 'Contrato v2.docx' }]);
    expect(harness.callTool).toHaveBeenCalledExactlyOnceWith(download.name, { params: { id: 'document-2' } }, expect.any(Number));
  });

  it('no ofrece descarga para documentos inexistentes o de otra organización', async () => {
    const download = tool('despacho_documents_download_link', 'Documentos: descargar enlace', true);
    const harness = createHarness({
      tools: [download],
      responses: [toolResponse('download', download.name, '{}'), finalResponse('Documento no encontrado.')],
    });
    harness.callTool.mockResolvedValueOnce({ isError: true, structuredContent: { result: {
      documentId: 'foreign-document', fileName: 'Privado.docx',
    } } });
    const reply = await harness.service.chat(chatDto('Descarga el documento'), testUser, 'token');
    expect(reply.downloads).toBeUndefined();
  });

  it('incorpora y prepara una escritura que no estaba en el catálogo inicial', async () => {
    const decoys = Array.from({ length: 30 }, (_, index) => tool(
      `despacho_general_${String(index).padStart(2, '0')}`,
      `General: opción ${index}`,
      true,
    ));
    const updateRequirement = tool(
      'despacho_requirements_update',
      'Requisitos: actualizar',
      false,
      { params: { type: 'object' }, body: { type: 'object' } },
    );
    const harness = createHarness({
      tools: [...decoys, updateRequirement],
      responses: [
        toolResponse('find-requirement-update', 'assistant_find_tools', JSON.stringify({
          query: 'actualizar un requisito',
        })),
        toolResponse('update-requirement', updateRequirement.name, JSON.stringify({
          params: { id: 'requirement-1' },
          body: { title: 'Requisito actualizado' },
        })),
      ],
    });

    const proposal = await harness.service.chat(
      chatDto('Necesito revisar las opciones generales'),
      testUser,
      'access-token',
    );

    const firstTools = harness.createResponse.mock.calls[0][0].tools;
    const secondTools = harness.createResponse.mock.calls[1][0].tools;
    expect(firstTools.some((candidate: { name: string }) => (
      candidate.name === updateRequirement.name
    ))).toBe(false);
    expect(secondTools.some((candidate: { name: string }) => (
      candidate.name === updateRequirement.name
    ))).toBe(true);
    expect(proposal.pendingAction?.title).toBe('Requisitos: actualizar');
    expect(harness.callTool).not.toHaveBeenCalled();
  });

  it('informa herramientas coincidentes aunque ya estuvieran disponibles', async () => {
    const search = tool('despacho_search_search', 'Búsqueda: buscar', true);
    const updatePerson = tool('despacho_directory_update_person', 'Directorio: actualizar persona', false);
    const harness = createHarness({
      tools: [search, updatePerson],
      responses: [
        toolResponse('find-directory', 'assistant_find_tools', JSON.stringify({
          query: 'consultar y actualizar la ficha de una persona',
        })),
        finalResponse('Encontré las funciones necesarias.'),
      ],
    });

    await harness.service.chat(
      chatDto('Completa la información faltante de David'),
      testUser,
      'access-token',
    );

    const retryInput = harness.createResponse.mock.calls[1][0]
      .input as Array<Record<string, unknown>>;
    expect(retryInput).toContainEqual(expect.objectContaining({
      type: 'function_call_output',
      call_id: 'find-directory',
      output: expect.stringContaining('despacho_directory_update_person'),
    }));
    expect(String(retryInput.at(-1)?.output)).toContain('alreadyAvailable');
  });

  it('consulta a la persona y prepara sólo los datos respaldados para actualizarla', async () => {
    const search = tool('despacho_search_search', 'Búsqueda: buscar', true);
    const updatePerson = tool(
      'despacho_directory_update_person',
      'Directorio: actualizar persona',
      false,
      { params: { type: 'object' }, body: { type: 'object' } },
    );
    const harness = createHarness({
      tools: [search, updatePerson],
      responses: [
        toolResponse('search-person', search.name, JSON.stringify({
          query: { q: 'David Zepeda' },
        })),
        toolResponse('update-person', updatePerson.name, JSON.stringify({
          params: { id: 'person-david' },
          body: {
            taxId: 'RFC test',
            birthDate: '1999-09-09',
            birthPlaceCity: 'Guadalajara',
            birthPlaceState: 'Jalisco',
            birthPlaceCountry: 'México',
            addressLine1: 'domicilio Test',
            addressLine2: 'colonia Test',
            city: 'municipio test',
            state: 'estado test',
            identificationType: 'INE',
            identificationNumber: '11111111',
            email: 'inventado@example.com',
          },
        })),
      ],
    });
    harness.callTool.mockResolvedValueOnce({
      structuredContent: {
        people: { items: [{ id: 'person-david', legalName: 'David Zepeda' }], hasMore: false },
      },
    });

    const proposal = await harness.service.chat(chatDto(
      'Completa la información faltante de David Zepeda: RFC RFC test; nació el 9 de septiembre de 1999 en Guadalajara, Jalisco; domicilio domicilio Test, colonia Test, municipio test, estado test; identificación INE, número 11111111.',
    ), testUser, 'access-token');

    expect(harness.callTool).toHaveBeenCalledOnce();
    expect(harness.callTool).toHaveBeenCalledWith(
      search.name,
      { query: { q: 'David Zepeda' } },
      expect.any(Number),
    );
    expect(proposal.pendingAction?.title).toBe('Directorio: actualizar persona');
    const summary = proposal.pendingAction?.operations[0].summary ?? '';
    expect(summary).toContain('person-david');
    expect(summary).toContain('1999-09-09');
    expect(summary).toContain('Guadalajara');
    expect(summary).toContain('11111111');
    expect(summary).not.toContain('birthPlaceCountry');
    expect(summary).not.toContain('inventado@example.com');
  });

  it('expone la creación de clientes como escritura y prepara su confirmación', async () => {
    const createPerson = tool(
      'despacho_directory_create_person',
      'Directorio: crear persona',
      false,
      { body: { type: 'object' } },
    );
    const body = {
      type: 'INDIVIDUAL',
      legalName: 'David Zepeda',
      givenName: 'David',
      familyName: 'Zepeda',
      gender: 'masculino',
      nationality: 'Mexicana',
      occupation: 'Ingeniero en Computación',
      maritalStatus: 'Soltero',
      birthDate: '2000-01-01T00:00:00.000Z',
      email: 'david.zepeda@example.com',
      phone: '101010101010',
      addressLine1: '',
    };
    const harness = createHarness({
      tools: [createPerson],
      responses: [toolResponse('create-person', createPerson.name, JSON.stringify({ body }))],
    });

    const proposal = await harness.service.chat(
      chatDto('Agrega al directorio al cliente David Zepeda, mexicano, ingeniero en computación, soltero, teléfono 101010101010'),
      testUser,
      'access-token',
    );

    const request = harness.createResponse.mock.calls[0][0];
    const providerTool = request.tools.find((candidate: { name: string }) => (
      candidate.name === createPerson.name
    ));
    expect(providerTool.description).toMatch(/cliente|contacto/);
    expect(providerTool.description).toMatch(/no envíes cadenas vacías/i);
    expect(request.instructions).toMatch(/campos opcionales desconocidos/i);
    expect(proposal.pendingAction?.title).toBe('Directorio: crear persona');
    expect(proposal.pendingAction?.operations[0].summary).toContain('David Zepeda');
    expect(proposal.pendingAction?.operations[0].summary).toContain('Ingeniero en Computación');
    expect(proposal.pendingAction?.operations[0].summary).toContain('101010101010');
    expect(proposal.pendingAction?.operations[0].summary).not.toContain('masculino');
    expect(proposal.pendingAction?.operations[0].summary).not.toContain('2000-01-01');
    expect(proposal.pendingAction?.operations[0].summary).not.toContain('example.com');
    expect(proposal.pendingAction?.operations[0].summary).not.toContain('addressLine1');
    expect(harness.callTool).not.toHaveBeenCalled();
  });

  it('envía identidad y pantalla como datos de usuario, no como instrucciones', async () => {
    const harness = createHarness({
      responses: [finalResponse('Listo.')],
    });

    await harness.service.chat({
      messages: [{ role: 'user', content: '¿Dónde estoy?' }],
      context: {
        pathname: '/auditoria/context-test-9283',
        title: 'Panel ultra secreto 9283',
      },
    }, testUser, 'access-token');

    const request = harness.createResponse.mock.calls[0][0];
    expect(request.instructions).not.toContain(testUser.displayName);
    expect(request.instructions).not.toContain(testUser.organizationName);
    expect(request.instructions).not.toContain('Panel ultra secreto 9283');
    expect(request.instructions).not.toContain('/auditoria/context-test-9283');
    expect(request.input[0]).toMatchObject({ role: 'user' });
    expect(request.input[0].content).toContain(testUser.displayName);
    expect(request.input[0].content).toContain(testUser.organizationName);
    expect(request.input[0].content).toContain('Panel ultra secreto 9283');
    expect(request.input[0].content).toContain('/auditoria/context-test-9283');
    expect(request.input[1]).toEqual({ role: 'user', content: '¿Dónde estoy?' });
  });

  it('devuelve al modelo un error para argumentos JSON inválidos sin llamar al MCP', async () => {
    const readTool = tool('despacho_tasks_list', 'Tareas: listar', true);
    const harness = createHarness({
      tools: [readTool],
      responses: [
        toolResponse('invalid-json', readTool.name, '{"estado":'),
        finalResponse('No pude ejecutar esa consulta.'),
      ],
    });

    await harness.service.chat(chatDto('Muéstrame las tareas'), testUser, 'access-token');

    expect(harness.callTool).not.toHaveBeenCalled();
    expect(harness.createResponse).toHaveBeenCalledTimes(2);
    const retryInput = harness.createResponse.mock.calls[1][0].input as Array<Record<string, unknown>>;
    expect(retryInput).toContainEqual(expect.objectContaining({
      type: 'function_call_output',
      call_id: 'invalid-json',
      output: expect.stringContaining('JSON inválido'),
    }));
  });

  it('rechaza una respuesta completa cuando excede el límite de llamadas', async () => {
    const readTool = tool('despacho_tasks_list', 'Tareas: listar', true);
    const harness = createHarness({
      tools: [readTool],
      config: { ASSISTANT_MAX_TOOL_CALLS_PER_RESPONSE: '1' },
      responses: [{
        output: [
          functionCall('call-1', readTool.name, {}),
          functionCall('call-2', readTool.name, {}),
        ],
      }],
    });

    const result = await harness.service.chat(chatDto('Muéstrame las tareas'), testUser, 'access-token');

    expect(result.message).toContain('límite es 1');
    expect(harness.callTool).not.toHaveBeenCalled();
    expect(harness.createResponse).toHaveBeenCalledOnce();
  });

  it('detiene rondas posteriores antes de exceder el límite total del turno', async () => {
    const readTool = tool('despacho_tasks_list', 'Tareas: listar', true);
    const harness = createHarness({
      tools: [readTool],
      config: { ASSISTANT_MAX_TOOL_CALLS_PER_TURN: '2' },
      responses: [
        toolResponse('call-1', readTool.name, '{}'),
        {
          output: [
            functionCall('call-2', readTool.name, {}),
            functionCall('call-3', readTool.name, {}),
          ],
        },
      ],
    });

    const result = await harness.service.chat(chatDto('Muéstrame las tareas'), testUser, 'access-token');

    expect(result.message).toContain('límite de 2 operaciones');
    expect(harness.callTool).toHaveBeenCalledOnce();
    expect(harness.callTool.mock.calls[0][0]).toBe(readTool.name);
    expect(harness.createResponse).toHaveBeenCalledTimes(2);
  });

  it('resume los resultados al agotar las rondas y conserva una continuación', async () => {
    const readTool = tool('despacho_tasks_list', 'Tareas: listar', true);
    const harness = createHarness({
      tools: [readTool],
      config: { ASSISTANT_MAX_TOOL_ROUNDS: '1' },
      responses: [
        toolResponse('call-1', readTool.name, '{}'),
        finalResponse('Estas son las tareas consultadas.'),
      ],
    });

    const result = await harness.service.chat(
      chatDto('Revisa todas mis tareas y continúa investigando'),
      testUser,
      'access-token',
    );

    expect(result.continuationSuggested).toBe(true);
    expect(result.continuationId).toEqual(expect.any(String));
    expect(result.message).toBe('Estas son las tareas consultadas.');
    expect(harness.callTool).toHaveBeenCalledOnce();
    expect(harness.createResponse.mock.calls[1][0]).toMatchObject({
      tools: [],
      toolChoice: 'none',
    });
  });

  it('propaga el presupuesto restante a MCP, proveedor y herramientas', async () => {
    const readTool = tool('despacho_tasks_list', 'Tareas: listar', true);
    const harness = createHarness({
      tools: [readTool],
      config: { ASSISTANT_TURN_TIMEOUT_MS: '10000' },
      responses: [
        toolResponse('call-1', readTool.name, '{}'),
        finalResponse('Aquí están.'),
      ],
    });

    await harness.service.chat(chatDto('Muéstrame las tareas'), testUser, 'access-token');

    expect(harness.connect).toHaveBeenCalledWith('access-token', expect.any(Number));
    expectBudget(harness.connect.mock.calls[0][1]);
    for (const [request] of harness.createResponse.mock.calls) expectBudget(request.timeoutMs);
    expectBudget(harness.callTool.mock.calls[0][2]);
  });

  it('prepara una sola escritura y ejecuta sólo esa confirmación una vez', async () => {
    const writeTool = tool('despacho_tasks_create', 'Tareas: crear', false);
    const harness = createHarness({
      tools: [writeTool],
      responses: [
        {
          output: [
            functionCall('write-1', writeTool.name, { title: 'Primera' }),
            functionCall('write-2', writeTool.name, { title: 'Segunda' }),
          ],
        },
        finalResponse('Creé la primera tarea.'),
      ],
    });

    const proposal = await harness.service.chat(
      chatDto('Crea dos tareas'),
      testUser,
      'access-token',
    );

    expect(proposal.message).toContain('todavía no se ejecutó');
    expect(proposal.pendingAction?.operations).toHaveLength(1);
    expect(harness.callTool).not.toHaveBeenCalled();

    await expect(harness.service.resolveAction(
      proposal.pendingAction!.id,
      true,
      { ...testUser, membershipId: 'another-membership' },
      'access-token',
    )).rejects.toThrow(/no existe o ya venció/);
    expect(harness.callTool).not.toHaveBeenCalled();

    const result = await harness.service.resolveAction(
      proposal.pendingAction!.id,
      true,
      testUser,
      'access-token',
    );

    expect(result.changed).toBe(true);
    expect(harness.callTool).toHaveBeenCalledOnce();
    expect(harness.callTool).toHaveBeenCalledWith(
      writeTool.name,
      { title: 'Primera' },
      expect.any(Number),
    );
    const confirmationInput = harness.createResponse.mock.calls[1][0]
      .input as Array<Record<string, unknown>>;
    expect(confirmationInput).toContainEqual(expect.objectContaining({
      type: 'function_call_output',
      call_id: 'write-2',
      output: expect.stringContaining('una operación de escritura'),
    }));
    expect(confirmationInput).toContainEqual(expect.objectContaining({
      type: 'function_call_output',
      call_id: 'write-1',
    }));
    await expect(harness.service.resolveAction(
      proposal.pendingAction!.id,
      true,
      testUser,
      'access-token',
    )).rejects.toThrow(/no existe o ya venció/);
    expect(harness.callTool).toHaveBeenCalledOnce();
  });

  it('limita las acciones pendientes por usuario', async () => {
    const writeTool = tool('despacho_tasks_create', 'Tareas: crear', false);
    const harness = createHarness({
      tools: [writeTool],
      config: { ASSISTANT_MAX_PENDING_ACTIONS_PER_USER: '1' },
      responses: [
        toolResponse('write-1', writeTool.name, '{"title":"Primera"}'),
        toolResponse('write-2', writeTool.name, '{"title":"Segunda"}'),
      ],
    });

    await harness.service.chat(chatDto('Crea una tarea'), testUser, 'access-token');
    await expect(harness.service.chat(
      chatDto('Crea otra tarea'),
      testUser,
      'access-token',
    )).rejects.toThrow(/Resuelve o cancela una acción pendiente/);
    expect(harness.callTool).not.toHaveBeenCalled();
  });
});

const testUser: AuthenticatedUser = {
  userId: 'user-1',
  email: 'ana@example.test',
  displayName: 'Ana Contexto 9283',
  organizationId: 'organization-1',
  organizationName: 'Organización Contexto 9283',
  membershipId: 'membership-1',
  role: MembershipRole.ADMIN,
};

function createHarness(options: {
  tools?: Tool[];
  responses: AssistantProviderResponse[];
  config?: Record<string, string>;
}) {
  const createResponse = vi.fn();
  for (const response of options.responses) createResponse.mockResolvedValueOnce(response);
  const callTool = vi.fn().mockResolvedValue({ structuredContent: { ok: true } });
  const close = vi.fn().mockResolvedValue(undefined);
  const session = { tools: options.tools ?? [], callTool, close };
  const connect = vi.fn().mockResolvedValue(session);
  const service = new AssistantService(
    { createResponse } as unknown as AssistantProviderService,
    { connect } as unknown as AssistantMcpService,
    new ConfigService(options.config ?? {}),
  );
  return { service, createResponse, connect, callTool, close };
}

function chatDto(content: string) {
  return { messages: [{ role: 'user' as const, content }] };
}

function finalResponse(text: string): AssistantProviderResponse {
  return { output: [], output_text: text };
}

function toolResponse(
  callId: string,
  name: string,
  args: string,
): AssistantProviderResponse {
  return { output: [{ type: 'function_call', call_id: callId, name, arguments: args }] };
}

function functionCall(callId: string, name: string, args: Record<string, unknown>) {
  return { type: 'function_call', call_id: callId, name, arguments: JSON.stringify(args) };
}

function expectBudget(value: unknown) {
  expect(value).toEqual(expect.any(Number));
  expect(value as number).toBeGreaterThan(0);
  expect(value as number).toBeLessThanOrEqual(10_000);
}

function tool(
  name: string,
  title: string,
  readOnlyHint: boolean,
  properties: Record<string, unknown> = {},
): Tool {
  return {
    name,
    title,
    description: title,
    inputSchema: { type: 'object', properties },
    annotations: {
      readOnlyHint,
      destructiveHint: false,
      idempotentHint: readOnlyHint,
      openWorldHint: false,
    },
  };
}
