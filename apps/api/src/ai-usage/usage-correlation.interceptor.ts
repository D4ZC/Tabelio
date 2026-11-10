import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { defer, lastValueFrom } from 'rxjs';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AiUsageService } from './ai-usage.service';
import { UsageCorrelationService, USAGE_CONTEXT_HEADER } from './usage-correlation.service';

@Injectable()
export class UsageCorrelationInterceptor implements NestInterceptor {
  constructor(private readonly usage: AiUsageService, private readonly correlation: UsageCorrelationService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const raw = request.headers[USAGE_CONTEXT_HEADER];
    if (raw === undefined) return next.handle();
    const address = request.socket?.remoteAddress;
    if (!request.user || Array.isArray(raw)
      || !['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(address ?? '')) {
      throw new ForbiddenException('El contexto de consumo sólo se admite en llamadas internas autenticadas.');
    }
    const operationId = this.correlation.verifyHeader(raw, request.user);
    // Subscribe inside AsyncLocalStorage, rather than returning an unsubscribed
    // Observable after leaving its scope.
    return defer(() => this.usage.resumeContext(request.user, operationId, () => lastValueFrom(next.handle())));
  }
}
