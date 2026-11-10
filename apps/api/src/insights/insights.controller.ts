import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { DocumentClassificationService } from './document-classification.service';
import { DocumentComparisonService } from './document-comparison.service';
import { InsightAiService } from './insight-ai.service';
import { InsightRequestDto } from './insight.dto';
import type { InsightResult } from './insight.types';
import { MatterInsightsService } from './matter-insights.service';

@Controller('insights')
export class InsightsController {
  constructor(
    private readonly matters: MatterInsightsService,
    private readonly comparison: DocumentComparisonService,
    private readonly classification: DocumentClassificationService,
    private readonly ai: InsightAiService,
    private readonly audit: AuditService,
  ) {}

  @Get('settings')
  @RequirePermissions('MATTER_READ')
  settings() { return this.ai.settings(); }

  @Post('matters/:id/summary')
  @RequirePermissions('MATTER_READ')
  async summary(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: InsightRequestDto) {
    return this.record(user, id, 'Matter', await this.matters.analyze(user, id, 'summary', dto));
  }

  @Post('matters/:id/consistency')
  @RequirePermissions('MATTER_READ')
  async consistency(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: InsightRequestDto) {
    return this.record(user, id, 'Matter', await this.matters.analyze(user, id, 'consistency', dto));
  }

  @Post('documents/:id/comparison')
  @RequirePermissions('DOCUMENT_READ')
  async compare(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: InsightRequestDto) {
    return this.record(user, id, 'Document', await this.comparison.analyze(user, id, dto));
  }

  @Post('documents/:id/classification')
  @RequirePermissions('DOCUMENT_READ')
  async classify(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: InsightRequestDto) {
    return this.record(user, id, 'Document', await this.classification.analyze(user, id, dto));
  }

  private async record(user: AuthenticatedUser, id: string, entityType: string, result: InsightResult) {
    await this.audit.record({
      organizationId: user.organizationId, actorUserId: user.userId,
      ...(entityType === 'Matter' ? { matterId: id } : {}),
      entityType, entityId: id, action: 'INSIGHT_GENERATED',
      payload: { kind: result.kind, mode: result.mode, sourceCount: result.sources.length },
    });
    return result;
  }
}
