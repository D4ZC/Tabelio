import { Global, Module } from '@nestjs/common';
import { AiUsageController } from './ai-usage.controller';
import { AiUsageService } from './ai-usage.service';
import { AI_BUDGET_PROVIDER } from './ai-usage.types';
import { IbmBudgetService } from './ibm-budget.service';
import { UsageCorrelationService } from './usage-correlation.service';

@Global()
@Module({
  controllers: [AiUsageController],
  providers: [AiUsageService, IbmBudgetService, UsageCorrelationService,
    { provide: AI_BUDGET_PROVIDER, useExisting: IbmBudgetService }],
  exports: [AiUsageService, UsageCorrelationService],
})
export class AiUsageModule {}
