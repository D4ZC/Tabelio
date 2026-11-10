import { ForbiddenException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService } from '@nestjs/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { hasPermission } from '@despacho/domain';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { extractSessionToken, SESSION_MAX_AGE_MS } from '../auth/session-token';
import { McpApiClient, type McpToolInput } from './mcp-api-client';
import { buildMcpOperationCatalog, type McpOperation } from './operation-catalog';
import { USAGE_CONTEXT_HEADER } from '../ai-usage/usage-correlation.service';

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: Server;
  user: AuthenticatedUser;
  accessToken: string;
  lastActiveAt: number;
  usageContext?: string;
}

@Injectable()
export class McpService implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, McpSession>();
  private operations: McpOperation[] = [];
  private cleanupTimer?: NodeJS.Timeout;
  private readonly sessionTtlMs: number;
  private readonly maxSessions: number;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly config: ConfigService,
    private readonly apiClient: McpApiClient,
  ) {
    this.sessionTtlMs = this.positiveInteger('MCP_SESSION_TTL_MS', SESSION_MAX_AGE_MS);
    this.maxSessions = this.positiveInteger('MCP_MAX_SESSIONS', 100);
  }

  onModuleInit() {
    this.operations = buildMcpOperationCatalog(this.discovery.getControllers());
    this.cleanupTimer = setInterval(() => void this.cleanupExpiredSessions(), 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  async onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.allSettled([...this.sessions.values()].map((session) => session.server.close()));
    this.sessions.clear();
  }

  async handle(
    request: Request,
    response: Response,
    body: unknown,
    user: AuthenticatedUser,
  ) {
    this.assertEnabledAndLocal(request);
    const accessToken = extractSessionToken(request);
    if (!accessToken) return this.httpError(response, 401, -32001, 'Falta una sesión válida.');

    const sessionId = this.header(request, 'mcp-session-id');
    let session = sessionId ? this.sessions.get(sessionId) : undefined;

    if (session) {
      if (!this.sameIdentity(session.user, user)) {
        return this.httpError(response, 403, -32003, 'La sesión MCP pertenece a otro usuario u organización.');
      }
      session.user = user;
      session.accessToken = accessToken;
      session.lastActiveAt = Date.now();
      session.usageContext = this.header(request, USAGE_CONTEXT_HEADER);
    } else if (request.method === 'POST' && !sessionId && isInitializeRequest(body)) {
      await this.cleanupExpiredSessions();
      if (this.sessions.size >= this.maxSessions) {
        return this.httpError(response, 503, -32000, 'Se alcanzó el máximo de sesiones MCP locales.');
      }
      session = await this.createSession(user, accessToken, this.header(request, USAGE_CONTEXT_HEADER));
    } else if (sessionId) {
      return this.httpError(response, 404, -32001, 'La sesión MCP no existe o venció.');
    } else {
      return this.httpError(response, 400, -32000, 'La petición no contiene una inicialización MCP válida.');
    }

    await session.transport.handleRequest(request, response, body);
  }

  operationCount() {
    return this.operations.length;
  }

  private async createSession(user: AuthenticatedUser, accessToken: string, usageContext?: string) {
    let session: McpSession;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, session);
      },
    });
    const server = this.createServer(() => session);
    session = {
      transport,
      server,
      user,
      accessToken,
      lastActiveAt: Date.now(),
      usageContext,
    };
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) this.sessions.delete(sessionId);
    };
    await server.connect(transport);
    return session;
  }

  private createServer(getSession: () => McpSession) {
    // La API de bajo nivel es intencional: el catálogo se descubre de los
    // controladores Nest y necesita publicar JSON Schema dinámico por operación.
    const server = new Server(
      { name: 'tabelio', version: '1.0.0' },
      {
        capabilities: { tools: {} },
        instructions:
          'Opera Tabelio con la identidad conectada. Consulta antes de modificar, usa los IDs devueltos por las herramientas y confirma con la persona cualquier acción marcada como destructiva. Nunca inventes identificadores ni intentes cambiar de organización. Las validaciones, permisos y auditoría se aplican en la API.',
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.visibleOperations(getSession().user).map((operation) => this.toTool(operation)),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const session = getSession();
      const operation = this.operations.find((candidate) => candidate.name === request.params.name);
      if (!operation) return this.toolError(`La herramienta ${request.params.name} no existe.`);
      if (!operation.permissions.every((permission) => hasPermission(session.user.role, permission))) {
        return this.toolError('El rol actual no permite ejecutar esta herramienta.');
      }
      const args = request.params.arguments;
      if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
        return this.toolError('Los argumentos de la herramienta deben ser un objeto.');
      }
      return this.apiClient.call(operation, (args ?? {}) as McpToolInput, session.accessToken, session.usageContext);
    });
    return server;
  }

  private visibleOperations(user: AuthenticatedUser) {
    return this.operations.filter((operation) =>
      operation.permissions.every((permission) => hasPermission(user.role, permission)),
    );
  }

  private toTool(operation: McpOperation): Tool {
    return {
      name: operation.name,
      title: operation.title,
      description: operation.description,
      inputSchema: operation.inputSchema as Tool['inputSchema'],
      annotations: operation.annotations,
    };
  }

  private async cleanupExpiredSessions() {
    const cutoff = Date.now() - this.sessionTtlMs;
    const expired = [...this.sessions.entries()].filter(([, session]) => session.lastActiveAt < cutoff);
    for (const [sessionId, session] of expired) {
      this.sessions.delete(sessionId);
      await session.server.close().catch(() => undefined);
    }
  }

  private assertEnabledAndLocal(request: Request) {
    if (this.config.get('MCP_ENABLED', 'true') !== 'true') {
      throw new ForbiddenException('El servidor MCP está deshabilitado.');
    }
    if (this.config.get('MCP_LOCAL_ONLY', 'true') !== 'true') return;
    const address = request.socket.remoteAddress ?? '';
    const isLoopback = address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
    if (!isLoopback) throw new ForbiddenException('El servidor MCP sólo acepta conexiones locales.');
  }

  private sameIdentity(left: AuthenticatedUser, right: AuthenticatedUser) {
    return left.userId === right.userId
      && left.membershipId === right.membershipId
      && left.organizationId === right.organizationId;
  }

  private toolError(message: string): CallToolResult {
    return { isError: true, content: [{ type: 'text', text: message }] };
  }

  private httpError(response: Response, status: number, code: number, message: string) {
    response.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
  }

  private header(request: Request, name: string) {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private positiveInteger(name: string, fallback: number) {
    const value = Number(this.config.get(name, String(fallback)));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
