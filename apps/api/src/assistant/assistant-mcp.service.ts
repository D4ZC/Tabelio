import {
  Injectable,
  Optional,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { UsageCorrelationService, USAGE_CONTEXT_HEADER } from '../ai-usage/usage-correlation.service';

export interface AssistantToolResult extends Record<string, unknown> {
  isError?: boolean;
}

export interface AssistantMcpSession {
  tools: Tool[];
  callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<AssistantToolResult>;
  close(): Promise<void>;
}

@Injectable()
export class AssistantMcpService {
  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly correlation?: UsageCorrelationService,
  ) {}

  async connect(accessToken: string, timeoutMs?: number): Promise<AssistantMcpSession> {
    const client = new Client({ name: 'tabelio-assistant', version: '1.0.0' });
    const usageContext = this.correlation?.headerForCurrentContext();
    const transport = new StreamableHTTPClientTransport(this.mcpUrl(), {
      requestInit: { headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(usageContext ? { [USAGE_CONTEXT_HEADER]: usageContext } : {}),
      } },
    });

    try {
      const configuredTimeout = this.positiveInteger('ASSISTANT_MCP_TIMEOUT_MS', 15_000);
      const timeout = Math.max(1, Math.min(configuredTimeout, timeoutMs ?? configuredTimeout));
      const connectionDeadline = Date.now() + timeout;
      await client.connect(transport, { timeout });
      const listed = await client.listTools(undefined, {
        timeout: Math.max(1, connectionDeadline - Date.now()),
      });
      const tools = listed.tools.filter(isSafeAssistantTool);
      return {
        tools,
        callTool: async (name, args, callTimeoutMs = configuredTimeout) => {
          try {
            return await client.callTool(
              { name, arguments: args },
              undefined,
              { timeout: Math.max(1, Math.min(configuredTimeout, callTimeoutMs)) },
            ) as AssistantToolResult;
          } catch (error) {
            throwMcpRequestError(error);
          }
        },
        close: async () => {
          await transport.terminateSession().catch(() => undefined);
          await client.close().catch(() => undefined);
        },
      };
    } catch (error) {
      await client.close().catch(() => undefined);
      throwMcpRequestError(error, 'Tabelio IA no pudo abrir una sesión con el MCP de la aplicación.');
    }
  }

  private mcpUrl() {
    const port = this.config.get('API_PORT', '4000');
    const raw = this.config.get('ASSISTANT_MCP_URL', `http://127.0.0.1:${port}/mcp`);
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
      if (!new Set(['localhost', '127.0.0.1', '[::1]']).has(url.hostname)) {
        throw new Error('non-loopback host');
      }
      return url;
    } catch {
      throw new ServiceUnavailableException('ASSISTANT_MCP_URL no es una URL válida.');
    }
  }

  private positiveInteger(name: string, fallback: number) {
    const value = Number(this.config.get(name, String(fallback)));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}

function throwMcpRequestError(
  error: unknown,
  unavailableMessage = 'Tabelio IA perdió la conexión con el MCP de la aplicación.',
): never {
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    throw new RequestTimeoutException('El MCP de la aplicación excedió el tiempo de espera.');
  }
  throw new ServiceUnavailableException(unavailableMessage);
}

export function isSafeAssistantTool(tool: Tool) {
  if (tool.name.startsWith('despacho_portal_')) return false;
  const schema = tool.inputSchema as { properties?: Record<string, unknown> };
  const properties = schema.properties ?? {};
  return !('files' in properties) && !('outputPath' in properties);
}
