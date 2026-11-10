import { MembershipRole } from '@despacho/database';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AssistantMcpService, type AssistantToolResult } from './assistant-mcp.service';
import {
  AssistantProviderService,
  type AssistantProviderInput,
  type AssistantProviderResponse,
} from './assistant-provider.service';
import { AssistantService } from './assistant.service';
import type { AssistantChatDto } from './dto/assistant.dto';

describe('continuación de consultas del asistente', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resume el listado y cinco detalles, y continúa con su contexto sin repetir las lecturas', async () => {
    const list = tool('despacho_matters_list', 'Expedientes: listar');
    const detail = tool('despacho_matters_get', 'Expedientes: detalles');
    const harness = createHarness({
      tools: [list, detail],
      config: { ASSISTANT_MAX_TOOL_ROUNDS: '6', ASSISTANT_MAX_TOOL_CALLS_PER_TURN: '6' },
      responses: [
        callsResponse([call('list', list.name, {})]),
        ...Array.from({ length: 5 }, (_, index) => callsResponse([
          call(`detail-${index + 1}`, detail.name, { params: { id: `matter-${index + 1}` } }),
        ])),
        finalResponse('Estos son los detalles de los primeros cinco expedientes.'),
        callsResponse([
          call('detail-1-again', detail.name, { params: { id: 'matter-1' } }),
          call('detail-6', detail.name, { params: { id: 'matter-6' } }),
        ]),
        finalResponse('El siguiente expediente es el sexto.'),
      ],
    });
    harness.callTool.mockImplementation(async (name, args) => ({
      structuredContent: name === list.name
        ? { items: Array.from({ length: 6 }, (_, index) => ({ id: `matter-${index + 1}` })) }
        : { id: args.params.id, title: `Expediente ${args.params.id}` },
    }));

    const first = await harness.service.chat(
      chatDto('Dame detalles sobre los primeros expedientes'),
      testUser,
      'first-access-token',
    );

    expect(first.message).toContain('detalles de los primeros cinco expedientes');
    expect(first.continuationSuggested).toBe(true);
    expect(first.continuationId).toMatch(uuidPattern);
    expect(harness.callTool).toHaveBeenCalledTimes(6);
    expect(harness.createResponse.mock.calls[6][0]).toMatchObject({ tools: [], toolChoice: 'none' });
    const summaryInput = harness.createResponse.mock.calls[6][0].input;
    expect(summaryInput).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call_output', call_id: 'list' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'detail-5' }),
    ]));

    const next = await harness.service.chat(
      { ...chatDto('Continúa desde donde te quedaste'), continuationId: first.continuationId },
      testUser,
      'refreshed-access-token',
    );

    expect(next.message).toContain('sexto');
    expect(harness.connect).toHaveBeenCalledTimes(2);
    expect(harness.connect).toHaveBeenLastCalledWith('refreshed-access-token', expect.any(Number));
    expect(harness.close).toHaveBeenCalledTimes(2);
    expect(harness.callTool).toHaveBeenCalledTimes(7);
    expect(harness.callTool.mock.calls.filter(([, args]) => args.params?.id === 'matter-1'))
      .toHaveLength(1);
    expect(harness.callTool).toHaveBeenLastCalledWith(
      detail.name,
      { params: { id: 'matter-6' } },
      expect.any(Number),
    );
    const resumed = harness.createResponse.mock.calls[7][0];
    expect(resumed.tools.map((candidate: { name: string }) => candidate.name))
      .toEqual(expect.arrayContaining([list.name, detail.name]));
    expect(resumed.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'Dame detalles sobre los primeros expedientes' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'list' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'detail-5' }),
    ]));
  });

  it('reutiliza lecturas idénticas con claves reordenadas y sintetiza tras dos rondas sin progreso', async () => {
    const list = tool('despacho_matters_list', 'Expedientes: listar');
    const harness = createHarness({
      tools: [list],
      config: { ASSISTANT_MAX_TOOL_ROUNDS: '10' },
      responses: [
        callsResponse([call('read-1', list.name, { query: { status: 'ACTIVE', page: 1 }, limit: 5 })]),
        callsResponse([call('read-2', list.name, { limit: 5, query: { page: 1, status: 'ACTIVE' } })]),
        callsResponse([call('read-3', list.name, { query: { page: 1, status: 'ACTIVE' }, limit: 5 })]),
        finalResponse('Encontré cinco expedientes activos.'),
      ],
    });

    const result = await harness.service.chat(chatDto('Lista mis expedientes activos'), testUser, 'access-token');

    expect(result.message).toContain('cinco expedientes activos');
    expect(result.continuationSuggested).toBe(true);
    expect(harness.callTool).toHaveBeenCalledOnce();
    expect(harness.createResponse).toHaveBeenCalledTimes(4);
    const summary = harness.createResponse.mock.calls[3][0];
    expect(summary).toMatchObject({ tools: [], toolChoice: 'none' });
    expect(summary.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call_output', call_id: 'read-1' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'read-2' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'read-3' }),
    ]));
  });

  it.each([
    ['persona', { userId: 'another-user' }],
    ['membresía', { membershipId: 'another-membership' }],
    ['organización', { organizationId: 'another-organization' }],
    ['rol', { role: MembershipRole.VIEWER }],
  ] as const)('rechaza una continuación al cambiar la %s', async (_label, identity) => {
    const harness = continuationHarness();
    const first = await harness.service.chat(chatDto('Lista mis expedientes'), testUser, 'access-token');

    await expect(harness.service.chat(
      { ...chatDto('Continúa'), continuationId: first.continuationId },
      { ...testUser, ...identity },
      'access-token',
    )).rejects.toThrow();

    expect(harness.connect).toHaveBeenCalledOnce();
    expect(harness.callTool).toHaveBeenCalledOnce();
  });

  it('rechaza una continuación que venció después de diez minutos', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const harness = continuationHarness();
    const first = await harness.service.chat(chatDto('Lista mis expedientes'), testUser, 'access-token');
    clock.mockReturnValue(now + 10 * 60 * 1_000 + 1);

    await expect(harness.service.chat(
      { ...chatDto('Continúa'), continuationId: first.continuationId },
      testUser,
      'access-token',
    )).rejects.toThrow();

    expect(harness.connect).toHaveBeenCalledOnce();
  });

  it('no ofrece continuar si falla la síntesis y el historial excede el tamaño permitido', async () => {
    const list = tool('despacho_matters_list', 'Expedientes: listar');
    const harness = createHarness({
      tools: [list],
      responses: [callsResponse([call('list', list.name, {})])],
    });
    const result = await harness.service.chat({
      messages: Array.from({ length: 24 }, () => ({
        role: 'user' as const,
        content: `Lista mis expedientes ${'界'.repeat(7_900)}`,
      })),
    }, testUser, 'access-token');

    expect(result.continuationSuggested).toBe(false);
    expect(result.continuationId).toBeUndefined();
    expect(result.message).not.toMatch(/puedes continuar/i);
    expect(harness.callTool).toHaveBeenCalledOnce();
  });

  it('consume el identificador una sola vez y no permite repetir la continuación', async () => {
    const harness = continuationHarness([finalResponse('Ya terminé la consulta.')]);
    const first = await harness.service.chat(chatDto('Lista mis expedientes'), testUser, 'access-token');
    const continuation = { ...chatDto('Continúa'), continuationId: first.continuationId };

    await harness.service.chat(continuation, testUser, 'access-token');
    await expect(harness.service.chat(continuation, testUser, 'access-token')).rejects.toThrow();

    expect(harness.connect).toHaveBeenCalledTimes(2);
    expect(harness.callTool).toHaveBeenCalledOnce();
  });

  it('vuelve a consultar una lectura previa después de una escritura confirmada', async () => {
    const list = tool('despacho_matters_list', 'Expedientes: listar');
    const update = tool('despacho_matters_update', 'Expedientes: actualizar', false);
    const harness = createHarness({
      tools: [list, update],
      config: { ASSISTANT_MAX_TOOL_ROUNDS: '6' },
      responses: [
        callsResponse([call('before-update', list.name, {})]),
        callsResponse([call('update', update.name, { params: { id: 'matter-1' }, body: { title: 'Actualizado' } })]),
        callsResponse([call('after-update', list.name, {})]),
        finalResponse('El expediente ahora se llama Actualizado.'),
      ],
    });

    const pending = await harness.service.chat(
      chatDto('Lista los expedientes, actualiza el primero con el título Actualizado y vuelve a listarlos'),
      testUser,
      'access-token',
    );
    expect(pending.pendingAction).toBeDefined();
    expect(harness.callTool).toHaveBeenCalledOnce();

    const result = await harness.service.resolveAction(pending.pendingAction!.id, true, testUser, 'access-token');

    expect(result.changed).toBe(true);
    expect(harness.callTool.mock.calls.map(([name]) => name)).toEqual([list.name, update.name, list.name]);
    expect(result.message).toContain('Actualizado');
  });

  it('invalida una continuación anterior cuando el usuario confirma otra escritura', async () => {
    const list = tool('despacho_matters_list', 'Expedientes: listar');
    const update = tool('despacho_matters_update', 'Expedientes: actualizar', false);
    const harness = createHarness({
      tools: [list, update],
      responses: [
        callsResponse([call('list', list.name, {})]),
        finalResponse('Encontré el primer expediente.'),
        callsResponse([call('update', update.name, { params: { id: 'matter-1' }, body: { title: 'Actualizado' } })]),
        finalResponse('Actualicé el expediente.'),
      ],
    });
    const first = await harness.service.chat(chatDto('Lista mis expedientes'), testUser, 'access-token');
    expect(first.continuationId).toMatch(uuidPattern);
    const pending = await harness.service.chat(chatDto('Actualiza el primer expediente'), testUser, 'access-token');

    const result = await harness.service.resolveAction(pending.pendingAction!.id, true, testUser, 'access-token');
    expect(result.changed).toBe(true);
    await expect(harness.service.chat(
      { ...chatDto('Continúa'), continuationId: first.continuationId },
      testUser,
      'access-token',
    )).rejects.toThrow();

    expect(harness.connect).toHaveBeenCalledTimes(3);
    expect(harness.callTool).toHaveBeenCalledTimes(2);
  });

  it('nunca ejecuta llamadas de herramientas inesperadas durante la síntesis', async () => {
    const list = tool('despacho_matters_list', 'Expedientes: listar');
    const detail = tool('despacho_matters_get', 'Expedientes: detalles');
    const harness = createHarness({
      tools: [list, detail],
      responses: [
        callsResponse([call('list', list.name, {})]),
        {
          output: [call('unexpected-detail', detail.name, { params: { id: 'matter-unexpected' } })],
          output_text: 'Consulté la lista de expedientes.',
        },
      ],
    });

    const result = await harness.service.chat(chatDto('Dame detalles de mis expedientes'), testUser, 'access-token');

    expect(result.message.trim()).not.toBe('');
    expect(result.continuationId).toMatch(uuidPattern);
    expect(harness.callTool).toHaveBeenCalledOnce();
    expect(harness.callTool).toHaveBeenCalledWith(list.name, {}, expect.any(Number));
    expect(harness.createResponse).toHaveBeenCalledTimes(2);
    expect(harness.createResponse.mock.calls[1][0]).toMatchObject({ tools: [], toolChoice: 'none' });
  });

  it('conserva la solicitud original al seleccionar herramientas con dos continuaciones de un cliente anterior', async () => {
    const list = tool('despacho_matters_list', 'Expedientes: listar');
    const harness = createHarness({
      tools: [list, tool('despacho_tasks_list', 'Tareas: listar')],
      responses: [finalResponse('Aquí están tus expedientes.')],
    });
    const messages: AssistantChatDto['messages'] = [
      { role: 'user', content: 'Dame detalles sobre los primeros expedientes' },
      { role: 'assistant', content: 'Alcancé el límite de operaciones de esta solicitud.' },
      { role: 'user', content: 'Continúa desde donde te quedaste' },
      { role: 'assistant', content: 'Alcancé el límite de operaciones de esta solicitud.' },
      { role: 'user', content: 'Continúa desde donde te quedaste' },
    ];

    await harness.service.chat({ messages }, testUser, 'access-token');

    const request = harness.createResponse.mock.calls[0][0];
    expect(request.tools.map((candidate: { name: string }) => candidate.name)).toContain(list.name);
    expect(request.input).toContainEqual(messages[0]);
  });
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const testUser: AuthenticatedUser = {
  userId: 'user-1',
  email: 'ana@example.test',
  displayName: 'Ana',
  organizationId: 'organization-1',
  organizationName: 'Organización',
  membershipId: 'membership-1',
  role: MembershipRole.ADMIN,
};

function createHarness(options: {
  tools: Tool[];
  responses: AssistantProviderResponse[];
  config?: Record<string, string>;
}) {
  const createResponse = vi.fn();
  for (const response of options.responses) createResponse.mockResolvedValueOnce(response);
  const callTool = vi.fn<(
    name: string,
    args: Record<string, any>,
    timeoutMs: number,
  ) => Promise<AssistantToolResult>>()
    .mockResolvedValue({ structuredContent: { items: [{ id: 'matter-1', title: 'Primer expediente' }] } });
  const close = vi.fn().mockResolvedValue(undefined);
  const connect = vi.fn().mockImplementation(async () => ({ tools: options.tools, callTool, close }));
  const service = new AssistantService(
    { createResponse } as unknown as AssistantProviderService,
    { connect } as unknown as AssistantMcpService,
    new ConfigService({ ASSISTANT_MAX_TOOL_ROUNDS: '1', ...options.config }),
  );
  return { service, createResponse, connect, callTool, close };
}

function continuationHarness(extraResponses: AssistantProviderResponse[] = []) {
  const list = tool('despacho_matters_list', 'Expedientes: listar');
  return createHarness({
    tools: [list],
    responses: [
      callsResponse([call('list', list.name, {})]),
      finalResponse('Encontré el primer expediente.'),
      ...extraResponses,
    ],
  });
}

function chatDto(content: string): AssistantChatDto {
  return { messages: [{ role: 'user', content }] };
}

function finalResponse(text: string): AssistantProviderResponse {
  return { output: [], output_text: text };
}

function callsResponse(output: AssistantProviderInput[]): AssistantProviderResponse {
  return { output };
}

function call(callId: string, name: string, args: Record<string, unknown>) {
  return { type: 'function_call', call_id: callId, name, arguments: JSON.stringify(args) };
}

function tool(name: string, title: string, readOnlyHint = true): Tool {
  return {
    name,
    title,
    description: title,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: false },
  };
}
