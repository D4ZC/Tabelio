import { AsyncLocalStorage } from 'node:async_hooks';
import { MembershipRole } from '@despacho/database';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AssistantService } from './assistant.service';
import type { AssistantProviderResponse } from './assistant-provider.service';

const conversationId = 'c13cb909-6468-4269-a2a9-5d0512bec2bb';
const actor: AuthenticatedUser = {
  userId: 'user-usage', organizationId: 'org-usage', membershipId: 'member-usage',
  email: 'usage@example.test', displayName: 'Persona de prueba', organizationName: 'Prueba',
  role: MembershipRole.ADMIN,
};
const message = { messages: [{ role: 'user' as const, content: 'Consulta las tareas pendientes' }] };

function harness(responses: AssistantProviderResponse[], tools: Tool[] = [], config = {}) {
  const context = new AsyncLocalStorage<{ conversationId?: string; kind: string }>();
  const seen: Array<{ conversationId?: string; kind: string } | undefined> = [];
  const usage = {
    createConversation: vi.fn().mockResolvedValue({ id: conversationId }),
    assertConversation: vi.fn(async (id: string) => {
      if (id !== conversationId) throw new Error('Conversación no encontrada');
    }),
    runOperation: vi.fn(async (_user: AuthenticatedUser, operation: { conversationId?: string; kind: string }, callback: () => Promise<unknown>) => (
      context.run(operation, callback)
    )),
  };
  const createResponse = vi.fn(async () => {
    seen.push(context.getStore());
    const response = responses.shift();
    if (!response) throw new Error('No hay respuesta de prueba');
    return response;
  });
  const connect = vi.fn(async () => ({
    tools, close: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockResolvedValue({ structuredContent: { ok: true } }),
  }));
  const service = new AssistantService(
    { createResponse } as never, { connect } as never,
    new ConfigService(config), undefined, usage as never,
  );
  return { service, usage, createResponse, connect, seen };
}

function final(text = 'Listo'): AssistantProviderResponse {
  return { output: [], output_text: text };
}

function tool(name: string, readOnly: boolean): Tool {
  return {
    name, title: readOnly ? 'Tareas: listar pendientes' : 'Tareas: crear',
    description: 'Consultar o crear tareas', inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: readOnly },
  };
}

function call(name: string): AssistantProviderResponse {
  return { output: [{ type: 'function_call', name, call_id: 'call-usage', arguments: '{}' }] };
}

describe('atribución del consumo en el asistente', () => {
  it('crea la conversación para un cliente anterior y conserva el contexto durante la llamada al proveedor', async () => {
    const { service, usage, seen } = harness([final()]);
    const result = await service.chat(message, actor, 'session');
    expect(usage.createConversation).toHaveBeenCalledWith(actor);
    expect(result.conversationId).toBe(conversationId);
    expect(seen).toEqual([{ conversationId, kind: 'CHAT', label: 'Mensaje del chat' }]);
  });

  it('rechaza una conversación ajena antes de conectar MCP o consumir IA', async () => {
    const { service, usage, createResponse, connect } = harness([final()]);
    await expect(service.chat({ ...message, conversationId: 'foreign' }, actor, 'session'))
      .rejects.toThrow('Conversación no encontrada');
    expect(usage.createConversation).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(createResponse).not.toHaveBeenCalled();
  });

  it('la confirmación hereda el chat de la propuesta sin depender de un ID enviado por el cliente', async () => {
    const write = tool('despacho_tasks_create', false);
    const { service, usage, seen } = harness([call(write.name), final('Tarea creada')], [write]);
    const first = await service.chat({
      conversationId, messages: [{ role: 'user', content: 'Crea una tarea' }],
    }, actor, 'session');
    expect(first.pendingAction).toBeDefined();
    const result = await service.resolveAction(first.pendingAction!.id, true, actor, 'session');
    expect(result.conversationId).toBe(conversationId);
    expect(seen.map((item) => [item?.conversationId, item?.kind])).toEqual([
      [conversationId, 'CHAT'], [conversationId, 'ACTION'],
    ]);
    expect(usage.assertConversation).toHaveBeenCalledTimes(2);
  });

  it('cancelar una propuesta conserva el chat y no abre otra operación facturable', async () => {
    const write = tool('despacho_tasks_create', false);
    const { service, usage, createResponse } = harness([call(write.name)], [write]);
    const first = await service.chat({
      conversationId, messages: [{ role: 'user', content: 'Crea una tarea' }],
    }, actor, 'session');
    const result = await service.resolveAction(first.pendingAction!.id, false, actor, 'session');
    expect(result.conversationId).toBe(conversationId);
    expect(usage.runOperation).toHaveBeenCalledOnce();
    expect(createResponse).toHaveBeenCalledOnce();
  });

  it('conserva la confirmación si no se pudo crear su operación persistente', async () => {
    const write = tool('despacho_tasks_create', false);
    const { service, usage, createResponse } = harness([call(write.name), final('Tarea creada')], [write]);
    const first = await service.chat({
      conversationId, messages: [{ role: 'user', content: 'Crea una tarea' }],
    }, actor, 'session');
    usage.runOperation.mockRejectedValueOnce(new Error('Registro no disponible'));
    await expect(service.resolveAction(first.pendingAction!.id, true, actor, 'session'))
      .rejects.toThrow('Registro no disponible');
    expect(createResponse).toHaveBeenCalledOnce();
    await expect(service.resolveAction(first.pendingAction!.id, true, actor, 'session'))
      .resolves.toMatchObject({ message: 'Tarea creada', conversationId });
  });

  it('continúa con la misma conversación y rechaza trasladar el gasto a otra', async () => {
    const read = tool('despacho_tasks_list', true);
    const { service, usage, seen, createResponse } = harness(
      [call(read.name), final('Consulta parcial'), final('Consulta terminada')],
      [read], { ASSISTANT_MAX_TOOL_ROUNDS: '1' },
    );
    const first = await service.chat({ ...message, conversationId }, actor, 'session');
    expect(first.continuationId).toBeDefined();
    await expect(service.chat({
      ...message, conversationId: 'another-chat', continuationId: first.continuationId,
    }, actor, 'session')).rejects.toThrow('otra conversación');
    expect(createResponse).toHaveBeenCalledTimes(2);
    const result = await service.chat({ ...message, continuationId: first.continuationId }, actor, 'session');
    expect(result.conversationId).toBe(conversationId);
    expect(usage.createConversation).not.toHaveBeenCalled();
    expect(seen.every((item) => item?.conversationId === conversationId)).toBe(true);
  });
});
