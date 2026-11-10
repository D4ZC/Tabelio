import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiUsageService } from './ai-usage.service';
import { DesktopBudgetSnapshotDto } from './budget-snapshot.dto';

export class UsageSummaryQueryDto {
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;
}

@Controller('ai-usage')
export class AiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Post('conversations')
  createConversation(@CurrentUser() user: AuthenticatedUser) {
    return this.usage.createConversation(user);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser, @Query() query: UsageSummaryQueryDto) {
    return this.usage.summary(user, query.conversationId);
  }

  @Post('budget-snapshot')
  saveBudgetSnapshot(@CurrentUser() user: AuthenticatedUser, @Body() body: DesktopBudgetSnapshotDto) {
    return this.usage.saveBudgetSnapshot(user, body);
  }
}
