import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AiUsageService } from './ai-usage.service';

export const USAGE_CONTEXT_HEADER = 'x-ai-usage-context';
const MAX_AGE_MS = 5 * 60_000;

/** Server-only attribution across the assistant → MCP → API HTTP boundaries. */
@Injectable()
export class UsageCorrelationService {
  constructor(private readonly usage: AiUsageService, private readonly config: ConfigService) {}

  headerForCurrentContext(): string | undefined {
    const context = this.usage.currentContext();
    if (!context) return undefined;
    const payload = Buffer.from(JSON.stringify({
      operationId: context.operationId,
      organizationId: context.organizationId,
      userId: context.userId,
      issuedAt: Date.now(),
    })).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verifyHeader(header: string, user: AuthenticatedUser): string {
    const invalid = () => new UnauthorizedException('El contexto de consumo de IA no es válido.');
    if (header.length > 2048) throw invalid();
    const [payload, signature, extra] = header.split('.');
    if (!payload || !signature || extra !== undefined) throw invalid();
    const actual = Buffer.from(signature, 'base64url');
    const expected = Buffer.from(this.sign(payload), 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
      if (value.userId !== user.userId || value.organizationId !== user.organizationId
        || typeof value.operationId !== 'string' || value.operationId.length > 100
        || typeof value.issuedAt !== 'number' || !Number.isFinite(value.issuedAt)
        || value.issuedAt > Date.now() + 5_000 || Date.now() - value.issuedAt > MAX_AGE_MS) {
        throw invalid();
      }
      return value.operationId;
    } catch {
      throw invalid();
    }
  }

  private sign(payload: string) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new ServiceUnavailableException('Falta la configuración de correlación interna de IA.');
    return createHmac('sha256', secret).update(`ai-usage:v1:${payload}`).digest('base64url');
  }
}
