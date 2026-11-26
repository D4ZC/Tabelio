import Anthropic from '@anthropic-ai/sdk';
import type {
  AssistantProviderInput,
  AssistantProviderOutputItem,
  AssistantProviderResponse,
  AssistantProviderTool,
} from './assistant-provider.service';

/**
 * Adaptador entre el formato interno de Tabelio (estilo OpenAI Responses, usado por el
 * asistente, la lectura de identificaciones y los análisis) y la Messages API de Claude.
 *
 * Los consumidores siguen recibiendo `output`, `output_text` y `usage` como antes. Para
 * repetir fielmente el turno del asistente en las rondas de herramientas, cada respuesta
 * incluye un elemento `anthropic_assistant` con los bloques originales (texto, thinking,
 * tool_use, fallback); los elementos derivados se marcan con `anthropic_message_id` para no
 * duplicarlos al reconstruir la conversación.
 */

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
export const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const ANTHROPIC_THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';
const ASSISTANT_ITEM = 'anthropic_assistant';

type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicRequestOptions {
  instructions: string;
  input: AssistantProviderInput[];
  tools: AssistantProviderTool[];
  toolChoice?: 'none';
  responseFormat?: { name: string; schema: Record<string, unknown> };
  model: string;
  maxOutputTokens: number;
  effort?: Effort;
}

export function anthropicModel(configured: string | undefined) {
  const model = configured?.trim();
  // `global-models` es el identificador del proveedor IBM; no existe en la API de Claude.
  return model && model.startsWith('claude-') ? model : ANTHROPIC_DEFAULT_MODEL;
}

export function anthropicEffort(configured: string | undefined): Effort {
  const value = configured?.trim().toLowerCase();
  return value === 'low' || value === 'high' || value === 'xhigh' || value === 'max' ? value : 'medium';
}

export function toAnthropicRequest(options: AnthropicRequestOptions): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const tools = options.tools.map((tool): Anthropic.Beta.BetaTool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema,
  }));
  return {
    model: options.model,
    max_tokens: options.maxOutputTokens,
    system: options.instructions,
    messages: toAnthropicMessages(options.input),
    ...(tools.length ? {
      tools,
      tool_choice: options.toolChoice === 'none'
        ? { type: 'none' as const }
        // Tabelio ejecuta las herramientas de una en una (equivale a parallel_tool_calls: false).
        : { type: 'auto' as const, disable_parallel_tool_use: true },
    } : {}),
    // El asistente descubre herramientas a mitad del turno, lo que cambia la lista `tools`.
    // Claude liga el razonamiento a esa lista; con `drop_block` descarta el bloque afectado
    // en lugar de rechazar la solicitud.
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    output_config: {
      effort: options.effort ?? 'medium',
      ...(options.responseFormat ? { format: { type: 'json_schema' as const, schema: options.responseFormat.schema } } : {}),
    },
    // Caché automática del prefijo: las rondas de herramientas repiten instrucciones e historial.
    cache_control: { type: 'ephemeral' },
    // Si el modelo declina por política, la API reintenta en el modelo de respaldo adecuado.
    fallbacks: 'default',
    betas: [ANTHROPIC_FALLBACK_BETA, ANTHROPIC_THINKING_BINDING_BETA],
  };
}

export function toAnthropicMessages(input: AssistantProviderInput[]): MessageParam[] {
  const messages: MessageParam[] = [];
  const replayed = new Set<string>();
  const push = (role: 'user' | 'assistant', content: ContentBlockParam[]) => {
    if (!content.length) return;
    const last = messages.at(-1);
    if (last?.role === role && Array.isArray(last.content)) last.content.push(...content);
    else messages.push({ role, content: [...content] });
  };

  for (const item of input) {
    const type = typeof item.type === 'string' ? item.type : undefined;
    if (type === ASSISTANT_ITEM && Array.isArray(item.content)) {
      if (typeof item.id === 'string') replayed.add(item.id);
      // Los bloques se devuelven sin cambios (incluidos thinking y su firma).
      push('assistant', item.content as ContentBlockParam[]);
      continue;
    }
    const sourceMessage = typeof item.anthropic_message_id === 'string' ? item.anthropic_message_id : undefined;
    if (sourceMessage && replayed.has(sourceMessage)) continue;

    if (type === 'function_call') {
      push('assistant', [{
        type: 'tool_use',
        id: String(item.call_id ?? ''),
        name: String(item.name ?? ''),
        input: parseArguments(item.arguments),
      }]);
      continue;
    }
    if (type === 'function_call_output') {
      push('user', [{
        type: 'tool_result',
        tool_use_id: String(item.call_id ?? ''),
        content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? null),
      }]);
      continue;
    }
    if (type === 'reasoning') continue;
    const role = item.role === 'assistant' ? 'assistant' : 'user';
    push(role, contentBlocks(item.content, role));
  }

  // La conversación debe iniciar con un mensaje del usuario.
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: [{ type: 'text', text: 'Continúa.' }] });
  return messages;
}

function contentBlocks(content: unknown, role: 'user' | 'assistant'): ContentBlockParam[] {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part): ContentBlockParam[] => {
    if (!part || typeof part !== 'object') return [];
    const block = part as Record<string, unknown>;
    if ((block.type === 'input_text' || block.type === 'output_text' || block.type === 'text') && typeof block.text === 'string') {
      return block.text.trim() ? [{ type: 'text', text: block.text }] : [];
    }
    if (role !== 'user') return [];
    if (block.type === 'input_image' && typeof block.image_url === 'string') {
      const data = parseDataUrl(block.image_url);
      if (!data || !IMAGE_TYPES.has(data.mediaType)) return [{ type: 'text', text: '[Imagen en un formato no compatible]' }];
      return [{ type: 'image', source: { type: 'base64', media_type: data.mediaType as ImageMediaType, data: data.base64 } }];
    }
    if (block.type === 'input_file' && typeof block.file_data === 'string') {
      const data = parseDataUrl(block.file_data);
      if (data?.mediaType !== 'application/pdf') return [{ type: 'text', text: '[Archivo en un formato no compatible]' }];
      return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.base64 } }];
    }
    return [];
  });
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
const IMAGE_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function parseDataUrl(value: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  return match ? { mediaType: match[1].toLowerCase(), base64: match[2] } : undefined;
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function fromAnthropicMessage(message: Anthropic.Beta.BetaMessage): AssistantProviderResponse {
  const output: AssistantProviderOutputItem[] = [
    { type: ASSISTANT_ITEM, id: message.id, role: 'assistant', content: message.content as unknown as Array<Record<string, unknown>> },
  ];
  const texts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      texts.push(block.text);
      output.push({
        type: 'message', role: 'assistant', anthropic_message_id: message.id,
        content: [{ type: 'output_text', text: block.text }],
      });
    } else if (block.type === 'tool_use') {
      output.push({
        type: 'function_call', anthropic_message_id: message.id,
        call_id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}),
      });
    }
  }

  const usage = message.usage;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  // El registro de consumo usa la convención de Responses: input_tokens incluye la caché.
  const inputTokens = usage.input_tokens + cacheRead + cacheWrite;
  const status = message.stop_reason === 'max_tokens' ? 'incomplete'
    : message.stop_reason === 'refusal' ? 'failed'
      : 'completed';
  return {
    id: message.id,
    model: message.model,
    status,
    output,
    output_text: texts.join('\n').trim(),
    ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    ...(status === 'failed' ? { error: { message: 'El modelo declinó la solicitud.' } } : {}),
    usage: {
      input_tokens: inputTokens,
      output_tokens: usage.output_tokens,
      total_tokens: inputTokens + usage.output_tokens,
      input_tokens_details: { cached_tokens: cacheRead, cache_creation_tokens: cacheWrite },
    },
  };
}
