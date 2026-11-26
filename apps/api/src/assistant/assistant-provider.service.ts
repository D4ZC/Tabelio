import {
  BadGatewayException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import {
  anthropicEffort,
  anthropicModel,
  fromAnthropicMessage,
  toAnthropicRequest,
} from './anthropic-provider';

export type AssistantProviderInput = Record<string, unknown>;

export interface AssistantProviderTool {
  type: 'function';
  strict?: false;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AssistantProviderOutputItem extends Record<string, unknown> {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: Array<Record<string, unknown>>;
}

export interface AssistantProviderResponse {
  id?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: Record<string, unknown>;
    output_tokens_details?: Record<string, unknown>;
    [key: string]: unknown;
  };
  status?: string;
  output: AssistantProviderOutputItem[];
  output_text?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
}

@Injectable()
export class AssistantProviderService {
  private readonly logger = new Logger(AssistantProviderService.name);
  private anthropic?: { apiKey: string; baseURL: string; client: Anthropic };

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly usage?: AiUsageService,
  ) {}

  async createResponse(options: {
    instructions: string;
    input: AssistantProviderInput[];
    tools: AssistantProviderTool[];
    toolChoice?: 'none';
    responseFormat?: { name: string; schema: Record<string, unknown> };
    timeoutMs?: number;
  }): Promise<AssistantProviderResponse> {
    if (this.config.get('ASSISTANT_ENABLED', 'false') !== 'true') {
      throw new ServiceUnavailableException('Tabelio IA está deshabilitado.');
    }

    const provider = this.provider();
    const apiKey = this.config.get<string>('ASSISTANT_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Falta configurar ASSISTANT_API_KEY en el servidor.',
      );
    }

    const configuredTimeout = this.positiveInteger('ASSISTANT_TIMEOUT_MS', 45_000);
    const timeoutMs = Math.max(1, Math.min(configuredTimeout, options.timeoutMs ?? configuredTimeout));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref();

    let activeAttempt: string | null = null;
    try {
      let maxOutputTokens = this.positiveInteger('ASSISTANT_MAX_OUTPUT_TOKENS', 6_000);
      const configuredModel = this.config.get('ASSISTANT_MODEL', 'global-models');
      const model = provider === 'anthropic' ? anthropicModel(configuredModel) : configuredModel;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        // Persist before making a billable call, including each physical retry.
        activeAttempt = await this.usage?.startAttempt(model) ?? null;
        const response = provider === 'anthropic'
          ? await this.sendAnthropic(apiKey, {
            ...options, model, maxOutputTokens, timeoutMs, signal: controller.signal, attemptId: activeAttempt,
          })
          : await fetch(this.responsesUrl(), {
          method: 'POST',
          headers: {
            ...this.headers(apiKey),
            ...(activeAttempt ? { 'X-Client-Request-Id': activeAttempt } : {}),
          },
          body: JSON.stringify({
            model,
            instructions: options.instructions,
            input: options.input,
            tools: options.tools.map((tool) => ({ ...tool, strict: false })),
            ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
            ...(options.responseFormat ? { text: { format: {
              type: 'json_schema',
              name: options.responseFormat.name,
              schema: options.responseFormat.schema,
              strict: true,
            } } } : {}),
            include: ['reasoning.encrypted_content'],
            parallel_tool_calls: false,
            max_output_tokens: maxOutputTokens,
            store: false,
          }),
          signal: controller.signal,
        });

        const payload = await response.json().catch(() => null) as AssistantProviderResponse | {
          error?: { message?: string };
          message?: string;
        } | null;
        // Usage can exist on an incomplete/failed response. Capture it before
        // validation or retry discards the payload.
        await this.usage?.finishAttempt(activeAttempt, {
          payload,
          responseHeaders: response.headers,
          httpStatus: response.status,
        });
        activeAttempt = null;
        if (!response.ok) {
          throw new BadGatewayException(
            `El proveedor de IA rechazó la solicitud (HTTP ${response.status}).`,
          );
        }
        if (!payload || !('output' in payload) || !Array.isArray(payload.output)) {
          throw new BadGatewayException('El proveedor de IA devolvió una respuesta incompatible.');
        }
        if (payload.status === 'failed' || payload.error) {
          throw new BadGatewayException('El proveedor de IA no pudo completar la respuesta.');
        }
        if (payload.status === 'incomplete') {
          const retryTokens = Math.min(maxOutputTokens * 2, 16_000);
          if (attempt === 0 && payload.incomplete_details?.reason === 'max_output_tokens'
            && retryTokens > maxOutputTokens && !controller.signal.aborted) {
            maxOutputTokens = retryTokens;
            continue;
          }
          throw new BadGatewayException('El proveedor de IA devolvió una respuesta incompleta.');
        }
        if (payload.output.length === 0 && !payload.output_text?.trim()) {
          throw new BadGatewayException('El proveedor de IA no devolvió contenido.');
        }
        return payload;
      }
      throw new BadGatewayException('El proveedor de IA no pudo completar la respuesta.');
    } catch (error) {
      if (activeAttempt) {
        // A timeout or persistence failure does not prove that IBM charged zero.
        await this.usage?.failAttempt(activeAttempt).catch(() => undefined);
      }
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadGatewayException('El proveedor de IA excedió el tiempo de espera.');
      }
      throw new BadGatewayException('No fue posible comunicarse con el proveedor de IA.');
    } finally {
      clearTimeout(timeout);
    }
  }

  /** `anthropic` usa la Messages API de Claude; cualquier otro valor conserva el formato Responses (IBM). */
  private provider(): 'anthropic' | 'responses' {
    const configured = this.config.get<string>('ASSISTANT_PROVIDER')?.trim().toLowerCase();
    if (configured) return configured === 'anthropic' || configured === 'claude' ? 'anthropic' : 'responses';
    try {
      return new URL(this.config.get('ASSISTANT_API_BASE_URL', '')).hostname === 'api.anthropic.com' ? 'anthropic' : 'responses';
    } catch {
      return 'responses';
    }
  }

  /**
   * Llama a Claude y entrega el resultado como un `Response` con el formato interno, para que
   * el registro de consumo, los reintentos y los errores sigan el mismo camino que con IBM.
   */
  private async sendAnthropic(apiKey: string, options: {
    instructions: string;
    input: AssistantProviderInput[];
    tools: AssistantProviderTool[];
    toolChoice?: 'none';
    responseFormat?: { name: string; schema: Record<string, unknown> };
    model: string;
    maxOutputTokens: number;
    timeoutMs: number;
    signal: AbortSignal;
    attemptId: string | null;
  }): Promise<Response> {
    const client = this.anthropicClient(apiKey);
    try {
      const { data, response } = await client.beta.messages.create(toAnthropicRequest({
        ...options,
        effort: anthropicEffort(this.config.get<string>('ASSISTANT_EFFORT')),
      }), {
        signal: options.signal,
        timeout: options.timeoutMs,
        ...(options.attemptId ? { headers: { 'X-Client-Request-Id': options.attemptId } } : {}),
      }).withResponse();
      return new Response(JSON.stringify(fromAnthropicMessage(data)), {
        status: response.status,
        headers: withRequestId(response.headers),
      });
    } catch (error) {
      if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) {
        const abort = new Error('El proveedor de IA excedió el tiempo de espera.');
        abort.name = 'AbortError';
        throw abort;
      }
      if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
        // El mensaje de Claude describe la causa (p. ej. un bloque inválido); nunca contiene la clave.
        this.logger.warn(`Claude rechazó la solicitud (HTTP ${error.status}): ${error.message.slice(0, 500)}`);
        return new Response(JSON.stringify({ error: { message: error.message } }), {
          status: error.status,
          headers: withRequestId(error.headers),
        });
      }
      throw error;
    }
  }

  private anthropicClient(apiKey: string) {
    const configured = this.config.get<string>('ASSISTANT_API_BASE_URL')?.trim();
    const baseURL = configured && new URL(configured).hostname !== 'api.servicesessentials.ibm.com'
      ? configured.replace(/\/+$/, '').replace(/\/v1$/, '')
      : 'https://api.anthropic.com';
    if (this.anthropic?.apiKey !== apiKey || this.anthropic.baseURL !== baseURL) {
      // Sin reintentos automáticos: cada llamada física debe registrarse como un intento facturable.
      this.anthropic = { apiKey, baseURL, client: new Anthropic({ apiKey, baseURL, maxRetries: 0 }) };
    }
    return this.anthropic.client;
  }

  private responsesUrl() {
    const configured = this.config.get(
      'ASSISTANT_API_BASE_URL',
      'https://api.servicesessentials.ibm.com',
    );
    let url: URL;
    try {
      url = new URL(configured);
    } catch {
      throw new ServiceUnavailableException('ASSISTANT_API_BASE_URL no es una URL válida.');
    }
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]']).has(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new ServiceUnavailableException('El proveedor de IA debe usar HTTPS.');
    }
    const explicitPath = this.config.get<string>('ASSISTANT_RESPONSES_PATH')?.trim();
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = explicitPath
      ? `/${explicitPath.replace(/^\/+/, '')}`
      : path.endsWith('/v1') ? `${path}/responses` : `${path}/v1/responses`;
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  private headers(apiKey: string) {
    const header = this.config.get('ASSISTANT_API_KEY_HEADER', 'Authorization').trim();
    const scheme = this.config.get('ASSISTANT_API_KEY_SCHEME', 'Bearer').trim();
    if (!/^[A-Za-z0-9-]+$/.test(header) || /[\r\n]/.test(scheme)) {
      throw new ServiceUnavailableException('La configuración de autenticación de Tabelio IA no es válida.');
    }
    return {
      [header]: scheme ? `${scheme} ${apiKey}` : apiKey,
      'Content-Type': 'application/json',
    };
  }

  private positiveInteger(name: string, fallback: number) {
    const value = Number(this.config.get(name, String(fallback)));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}

/** Claude informa `request-id`; el registro de consumo lo busca como `x-request-id`. */
function withRequestId(source: Headers | Record<string, string> | undefined) {
  const headers = new Headers(source ?? undefined);
  const requestId = headers.get('request-id');
  if (requestId && !headers.has('x-request-id')) headers.set('x-request-id', requestId);
  return headers;
}
