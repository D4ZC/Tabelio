import { Body, Controller, Get, Param, ParseEnumPipe, Patch, Post, Res } from '@nestjs/common';
import { LaunchIntegrationKind } from '@despacho/database';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import {
  CompleteLaunchControlDto,
  CreateLaunchUatCaseDto,
  DecideLaunchDto,
  ReopenLaunchControlDto,
  ReviewLaunchUatCaseDto,
  RunLaunchIntegrationDto,
  StartLaunchCycleDto,
  SubmitLaunchReviewDto,
  UpdateLaunchProgramDto,
} from './dto/launch.dto';
import { LaunchService } from './launch.service';

@Controller('launch')
export class LaunchController {
  constructor(private readonly launch: LaunchService) {}

  @Get()
  @RequirePermissions('LAUNCH_READ')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.launch.overview(user);
  }

  @Get('export.csv')
  @RequirePermissions('LAUNCH_MANAGE')
  async exportCsv(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) response: Response) {
    const csv = await this.launch.exportCsv(user);
    response.type('text/csv; charset=utf-8');
    response.attachment(csv.fileName);
    return csv.content;
  }

  @Patch('program')
  @RequirePermissions('LAUNCH_MANAGE')
  updateProgram(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateLaunchProgramDto) {
    return this.launch.updateProgram(user, dto);
  }

  @Post('program/cycles')
  @RequirePermissions('LAUNCH_MANAGE')
  startCycle(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartLaunchCycleDto) {
    return this.launch.startCycle(user, dto);
  }

  @Post('uat')
  @RequirePermissions('LAUNCH_MANAGE')
  createUatCase(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLaunchUatCaseDto) {
    return this.launch.createUatCase(user, dto);
  }

  @Patch('uat/:id')
  @RequirePermissions('LAUNCH_MANAGE')
  reviewUatCase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewLaunchUatCaseDto,
  ) {
    return this.launch.reviewUatCase(user, id, dto);
  }

  @Post('integrations/:kind/test')
  @RequirePermissions('LAUNCH_MANAGE')
  runIntegration(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', new ParseEnumPipe(LaunchIntegrationKind)) kind: LaunchIntegrationKind,
    @Body() dto: RunLaunchIntegrationDto,
  ) {
    return this.launch.runIntegration(user, kind, dto);
  }

  @Post('controls/:code/complete')
  @RequirePermissions('LAUNCH_MANAGE')
  completeControl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: CompleteLaunchControlDto,
  ) {
    return this.launch.completeControl(user, code, dto);
  }

  @Post('controls/:code/reopen')
  @RequirePermissions('LAUNCH_MANAGE')
  reopenControl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: ReopenLaunchControlDto,
  ) {
    return this.launch.reopenControl(user, code, dto.reason);
  }

  @Post('metrics/capture')
  @RequirePermissions('LAUNCH_MANAGE')
  captureMetrics(@CurrentUser() user: AuthenticatedUser) {
    return this.launch.captureMetrics(user);
  }

  @Post('review/submit')
  @RequirePermissions('LAUNCH_MANAGE')
  submitReview(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitLaunchReviewDto) {
    return this.launch.submitReview(user, dto);
  }

  @Post('review/reopen')
  @RequirePermissions('LAUNCH_MANAGE')
  reopenReview(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReopenLaunchControlDto) {
    return this.launch.reopenReview(user, dto.reason);
  }

  @Post('decision')
  @RequirePermissions('LAUNCH_MANAGE')
  decide(@CurrentUser() user: AuthenticatedUser, @Body() dto: DecideLaunchDto) {
    return this.launch.decide(user, dto);
  }
}
