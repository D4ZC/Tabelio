import {
  Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@despacho/database';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_BUDGET_PROVIDER, unavailableBudget,
  type AiBudgetProvider, type BudgetView, type ProviderCost, type UsageContext,
} from './ai-usage.types';
import { aggregateUsage, readUsage, record, safeIdentifier, type UsageGroup } from './usage-totals';
import { configuredModelTariff, estimateWithTariff, validCostCurrency, type TariffEstimate } from './usage-pricing';
import type { DesktopBudgetSnapshotDto } from './budget-snapshot.dto';
import { DesktopBudgetSnapshots } from './desktop-budget-snapshots';

interface OperationOptions {
  conversationId?: string | null;
  kind: string;
  label: string;
  documentId?: string;
}

export interface FinishAttemptOptions {
  payload: unknown;
  responseHeaders?: Headers;
  httpStatus?: number;
  cost?: ProviderCost;
}

const usageSums = {
  confirmedCost: true, estimatedCost: true, inputTokens: true, outputTokens: true,
} as const;

@Injectable()
export class AiUsageService {
  private readonly context = new AsyncLocalStorage<Readonly<UsageContext>>();
  private readonly logger = new Logger(AiUsageService.name);
  private readonly desktopBudgetSnapshots = new DesktopBudgetSnapshots();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() @Inject(AI_BUDGET_PROVIDER) private readonly budgetProvider?: AiBudgetProvider,
  ) {}

  createConversation(user: AuthenticatedUser) {
    return this.prisma.aiConversation.create({
      data: { organizationId: user.organizationId, userId: user.userId },
      select: { id: true },
    });
  }

  async saveBudgetSnapshot(user: AuthenticatedUser, input: DesktopBudgetSnapshotDto) {
    const configured = await this.budgetProvider?.getBudget(user) ?? unavailableBudget();
    const snapshot = this.desktopBudgetSnapshots.put(user, input, configured);
    return { saved: true, updatedAt: snapshot.updatedAt, expiresAt: snapshot.snapshotExpiresAt };
  }

  async assertConversation(id: string, user: AuthenticatedUser) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id, organizationId: user.organizationId, userId: user.userId },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException('No se encontró la conversación.');
    return conversation;
  }

  currentContext(): Readonly<UsageContext> | undefined {
    return this.context.getStore();
  }

  async resumeContext<T>(user: AuthenticatedUser, operationId: string, callback: () => Promise<T>): Promise<T> {
    const operation = await this.prisma.aiOperation.findFirst({
      where: { id: operationId, organizationId: user.organizationId, userId: user.userId },
      select: { id: true, conversationId: true },
    });
    if (!operation) throw new NotFoundException('No se encontró la operación de IA.');
    return this.context.run(Object.freeze({
      organizationId: user.organizationId, userId: user.userId,
      operationId: operation.id, conversationId: operation.conversationId,
    }), callback);
  }

  async runOperation<T>(user: AuthenticatedUser, options: OperationOptions, callback: () => Promise<T>): Promise<T> {
    const inherited = this.currentContext();
    const parent = inherited?.userId === user.userId && inherited.organizationId === user.organizationId
      ? inherited : undefined;
    const conversationId = options.conversationId === undefined
      ? parent?.conversationId ?? null : options.conversationId;
    if (conversationId) await this.assertConversation(conversationId, user);
    const operation = await this.prisma.aiOperation.create({
      data: {
        organizationId: user.organizationId, userId: user.userId, conversationId,
        parentId: parent && parent.conversationId === conversationId ? parent.operationId : null,
        kind: options.kind.slice(0, 40), label: options.label.slice(0, 160),
        documentId: options.documentId,
      },
      select: { id: true },
    });
    return this.context.run(Object.freeze({
      organizationId: user.organizationId, userId: user.userId,
      operationId: operation.id, conversationId,
    }), async () => {
      try {
        const result = await callback();
        await this.completeOperation(operation.id, 'COMPLETED');
        return result;
      } catch (error) {
        await this.completeOperation(operation.id, 'FAILED');
        throw error;
      }
    });
  }

  async startAttempt(model: string): Promise<string | null> {
    const context = this.currentContext();
    if (!context) throw new ServiceUnavailableException('No hay un contexto autorizado para registrar el consumo de IA.');
    try {
      const attempt = await this.prisma.aiUsageAttempt.create({
        data: {
          organizationId: context.organizationId, userId: context.userId,
          operationId: context.operationId, model: model.slice(0, 160),
        },
        select: { id: true },
      });
      return attempt.id;
    } catch {
      // Fail before making a billable call if its durable trace cannot be created.
      throw new ServiceUnavailableException('No fue posible registrar el consumo de IA. Intenta de nuevo.');
    }
  }

  async finishAttempt(id: string | null, options: FinishAttemptOptions): Promise<void> {
    if (!id) return;
    const usage = readUsage(options.payload);
    const supplied = this.validCost(options.cost);
    const reported = this.validCost(this.configuredCost(options));
    // A provider-reported amount takes priority over any estimate.
    let cost = supplied?.estimated ? reported ?? supplied : supplied ?? reported;
    let estimate: TariffEstimate | null = null;
    if (!cost && this.config.get<string>('AI_USAGE_PRICING_JSON')) {
      try {
        const attempt = await this.prisma.aiUsageAttempt.findFirst({
          where: { id, state: 'STARTED' }, select: { model: true, createdAt: true },
        });
        if (attempt) {
          const tariff = configuredModelTariff(
            this.config.get('AI_USAGE_PRICING_JSON'), usage.model ?? attempt.model, attempt.createdAt,
          );
          estimate = tariff ? estimateWithTariff(tariff, usage) : null;
          cost = this.validCost(estimate ?? undefined);
        }
      } catch {
        // Usage must still be persisted even when pricing is unavailable.
        this.logger.warn('No se pudo estimar el consumo de IA; se conservará pendiente.');
      }
    }
    const { model, ...tokenFields } = usage;
    try {
      await this.prisma.aiUsageAttempt.updateMany({
        where: { id, state: 'STARTED' },
        data: {
          ...tokenFields,
          ...(model ? { model } : {}),
          providerRequestId: safeIdentifier(options.responseHeaders?.get('x-request-id')),
          httpStatus: options.httpStatus,
          ...(cost ? {
            confirmedCost: cost.estimated ? null : cost.amount,
            estimatedCost: cost.estimated ? cost.amount : null,
            currency: cost.currency, costSource: cost.source,
            ...(estimate ? { pricingSnapshotJson: estimate.snapshot } : {}),
          } : {}),
          state: cost ? (cost.estimated ? 'ESTIMATED' : 'CONFIRMED') : 'PENDING',
          completedAt: new Date(),
        },
      });
    } catch {
      // STARTED remains durable and appears pending; do not repeat a successful call.
      this.logger.warn('No se pudo finalizar el registro de consumo de IA; permanece pendiente.');
    }
  }

  async failAttempt(id: string | null): Promise<void> {
    if (!id) return;
    try {
      await this.prisma.aiUsageAttempt.updateMany({
        where: { id, state: 'STARTED' }, data: { state: 'PENDING', completedAt: new Date() },
      });
    } catch {
      this.logger.warn('El intento de IA permanece abierto y pendiente de conciliación.');
    }
  }

  /** Explicit backfill only: historical attempts require a documented effectiveFrom. */
  async estimatePending(user: AuthenticatedUser, options: {
    conversationId?: string; limit?: number; afterId?: string; dryRun?: boolean;
  } = {}) {
    if (options.conversationId) await this.assertConversation(options.conversationId, user);
    const raw = this.config.get<string>('AI_USAGE_PRICING_JSON');
    if (!raw) return { examined: 0, updated: 0, skipped: 0, nextCursor: null, estimates: [] };
    const scope = { organizationId: user.organizationId, userId: user.userId };
    const cursor = options.afterId ? await this.prisma.aiUsageAttempt.findFirst({
      where: {
        ...scope, id: options.afterId,
        ...(options.conversationId ? { operation: { conversationId: options.conversationId } } : {}),
      }, select: { createdAt: true, id: true },
    }) : null;
    if (options.afterId && !cursor) throw new NotFoundException('No se encontró el cursor de consumo.');
    const limit = Number.isSafeInteger(options.limit) ? Math.max(1, Math.min(options.limit!, 500)) : 100;
    const attempts = await this.prisma.aiUsageAttempt.findMany({
      where: {
        ...scope, state: 'PENDING', confirmedCost: null, estimatedCost: null,
        inputTokens: { not: null }, outputTokens: { not: null },
        ...(options.conversationId ? { operation: { conversationId: options.conversationId } } : {}),
        ...(cursor ? { OR: [
          { createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true, model: true, createdAt: true, inputTokens: true, outputTokens: true,
        cachedInputTokens: true, reasoningTokens: true,
      },
    });
    let updated = 0;
    const estimates: Array<{ attemptId: string; model: string; amount: string; currency: string; source: string; applied: boolean }> = [];
    for (const attempt of attempts) {
      const tariff = configuredModelTariff(raw, attempt.model, attempt.createdAt, true);
      const estimate = tariff ? estimateWithTariff(tariff, attempt) : null;
      if (!estimate) continue;
      const result = options.dryRun ? { count: 0 } : await this.prisma.aiUsageAttempt.updateMany({
        where: { ...scope, id: attempt.id, state: 'PENDING', confirmedCost: null, estimatedCost: null },
        data: {
          estimatedCost: new Prisma.Decimal(estimate.amount), currency: estimate.currency,
          state: 'ESTIMATED', costSource: estimate.source, pricingSnapshotJson: estimate.snapshot,
        },
      });
      updated += result.count;
      estimates.push({
        attemptId: attempt.id, model: attempt.model, amount: estimate.amount, currency: estimate.currency,
        source: estimate.source, applied: result.count === 1,
      });
    }
    return {
      examined: attempts.length, updated, skipped: attempts.length - estimates.length,
      nextCursor: attempts.length === limit ? attempts.at(-1)!.id : null, estimates,
    };
  }

  async summary(user: AuthenticatedUser, conversationId?: string) {
    if (conversationId) await this.assertConversation(conversationId, user);
    const scope = { organizationId: user.organizationId, userId: user.userId };
    const conversationScope = { ...scope, operation: { conversationId } };
    const operationSelect = { id: true, kind: true, label: true, status: true, createdAt: true, parentId: true } as const;
    const [personalGroups, conversationGroups, first, operations, latestOperation, budget] = await Promise.all([
      this.prisma.aiUsageAttempt.groupBy({ by: ['state', 'currency'], where: scope, _count: true, _sum: usageSums }),
      conversationId ? this.prisma.aiUsageAttempt.groupBy({
        by: ['state', 'currency'], where: conversationScope, _count: true, _sum: usageSums,
      }) : Promise.resolve([]),
      this.prisma.aiUsageAttempt.aggregate({ where: scope, _min: { createdAt: true } }),
      conversationId ? this.prisma.aiOperation.findMany({
        where: { ...scope, conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
        select: operationSelect,
      }) : Promise.resolve([]),
      this.prisma.aiOperation.findFirst({
        where: scope, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: operationSelect,
      }),
      this.budget(user),
    ]);
    const operationIds = [...new Set([
      ...operations.map((operation) => operation.id), ...(latestOperation ? [latestOperation.id] : []),
    ])];
    const operationGroups = operationIds.length ? await this.prisma.aiUsageAttempt.groupBy({
      by: ['operationId', 'state', 'currency'],
      where: { ...scope, operationId: { in: operationIds } },
      _count: true, _sum: usageSums,
    }) : [];
    const grouped = new Map<string, UsageGroup[]>();
    for (const group of operationGroups) {
      const values = grouped.get(group.operationId) ?? [];
      values.push(group);
      grouped.set(group.operationId, values);
    }
    const operationView = (operation: typeof operations[number]) => ({
      ...operation, createdAt: operation.createdAt.toISOString(), total: aggregateUsage(grouped.get(operation.id) ?? []),
    });
    return {
      conversationId: conversationId ?? null,
      measuredSince: first._min.createdAt?.toISOString() ?? null,
      personal: aggregateUsage(personalGroups), conversation: aggregateUsage(conversationGroups),
      operations: operations.map(operationView),
      latestOperation: latestOperation ? operationView(latestOperation) : null,
      budget,
      pricing: this.pricingStatus(),
    };
  }

  private async completeOperation(id: string, status: 'COMPLETED' | 'FAILED') {
    try {
      await this.prisma.aiOperation.update({ where: { id }, data: { status, completedAt: new Date() } });
    } catch {
      this.logger.warn('No se pudo actualizar el estado de una operación de IA.');
    }
  }

  private async budget(user: AuthenticatedUser): Promise<BudgetView> {
    try {
      const configured = await this.budgetProvider?.getBudget(user) ?? unavailableBudget();
      return this.desktopBudgetSnapshots.overlay(user, configured);
    } catch {
      return unavailableBudget();
    }
  }

  private configuredCost(options: FinishAttemptOptions): ProviderCost | undefined {
    // These fields have no defaults: their meaning and currency must be verified with the provider.
    const currency = this.config.get<string>('AI_USAGE_PROVIDER_COST_CURRENCY');
    const header = this.config.get<string>('AI_USAGE_PROVIDER_COST_HEADER');
    const path = this.config.get<string>('AI_USAGE_PROVIDER_COST_JSON_PATH');
    if (!validCostCurrency(currency)) return undefined;
    const validHeader = header && header.length <= 200 && /^[A-Za-z0-9-]+$/.test(header);
    let value: unknown = validHeader ? options.responseHeaders?.get(header) : undefined;
    if (value == null && path && path.length <= 200 && path.split('.').every((part) => part.length > 0)) {
      value = path.split('.').reduce<unknown>((current, key) => (
        Object.hasOwn(record(current), key) ? record(current)[key] : undefined
      ), options.payload);
    }
    return typeof value === 'string' || typeof value === 'number'
      ? { amount: String(value), currency, source: 'provider' } : undefined;
  }

  private pricingStatus() {
    const currency = this.config.get<string>('AI_USAGE_PROVIDER_COST_CURRENCY');
    const header = this.config.get<string>('AI_USAGE_PROVIDER_COST_HEADER');
    const path = this.config.get<string>('AI_USAGE_PROVIDER_COST_JSON_PATH');
    const providerConfigured = validCostCurrency(currency) && Boolean(
      header && header.length <= 200 && /^[A-Za-z0-9-]+$/.test(header)
      || path && path.length <= 200 && path.split('.').every((part) => part.length > 0),
    );
    const tariff = configuredModelTariff(
      this.config.get('AI_USAGE_PRICING_JSON'), this.config.get('ASSISTANT_MODEL', 'global-models'), new Date(),
    );
    const reference = tariff && (tariff.currency === 'USD' || /reference|referencia|orientativ/i.test(tariff.version));
    const openaiReference = reference && new URL(tariff.sourceUrl).hostname === 'developers.openai.com';
    return providerConfigured || tariff ? {
      status: 'configured' as const,
      ...(tariff ? { sourceUrl: tariff.sourceUrl, version: tariff.version } : {}),
      message: reference
        ? `${providerConfigured ? 'Se prioriza el costo informado por el proveedor. ' : ''}${openaiReference ? 'Referencia OpenAI Standard Global. ' : ''}Tarifa de referencia por 1M tokens: entrada ${tariff.inputPerMillion}, caché ${tariff.cachedInputPerMillion ?? 'no configurada'} y salida ${tariff.outputPerMillion} ${tariff.currency}. Las estimaciones no representan el cargo definitivo de IBM ni una equivalencia con Advantage Credits. No incluyen recargos por escritura de caché, modalidad o región.`
        : 'Costo por llamada configurado. Las estimaciones se identifican y los datos faltantes permanecen pendientes.',
    } : {
      status: 'unconfigured' as const,
      message: 'No hay una tarifa de referencia ni un campo de costo configurado para este modelo.',
    };
  }

  private validCost(cost?: ProviderCost) {
    if (!cost || !validCostCurrency(cost.currency)
      || !/^\d+(?:\.\d+)?(?:e[+-]?\d{1,3})?$/i.test(cost.amount)
      || !/^[\w .:-]{1,80}$/.test(cost.source)) return undefined;
    try {
      const amount = new Prisma.Decimal(cost.amount);
      if (!amount.isFinite() || amount.isNegative() || amount.gte('1000000000000')) return undefined;
      const rounded = amount.toDecimalPlaces(12);
      if (amount.gt(0) && rounded.isZero()) return undefined;
      return { ...cost, amount: rounded };
    } catch {
      return undefined;
    }
  }
}
