import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CompletePilotCheckpointDto, ReopenPilotCheckpointDto } from './dto/pilot-checkpoint.dto';
import {
  AddPilotParticipantDto,
  CancelPilotImportDto,
  ConfirmPilotTrainingDto,
  CreatePilotImportDto,
  CreatePilotIssueDto,
  CreatePilotValidationDto,
  RemovePilotParticipantDto,
  ReviewPilotValidationDto,
  StartPilotCycleDto,
  TransitionPilotProgramDto,
  UpdatePilotIssueDto,
  UpdatePilotProgramDto,
} from './dto/pilot-operations.dto';
import { PilotOperationsService } from './pilot-operations.service';
import { PilotService } from './pilot.service';

@Controller('pilot')
export class PilotController {
  constructor(
    private readonly pilot: PilotService,
    private readonly operations: PilotOperationsService,
  ) {}

  @Get('readiness')
  @RequirePermissions('PILOT_READ')
  readiness(@CurrentUser() user: AuthenticatedUser) {
    return this.pilot.readiness(user);
  }

  @Get('readiness.csv')
  @RequirePermissions('PILOT_MANAGE')
  async readinessCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.pilot.exportCsv(user);
    response.type('text/csv; charset=utf-8');
    response.attachment(csv.fileName);
    return csv.content;
  }

  @Post('checkpoints/:code/complete')
  @RequirePermissions('PILOT_MANAGE')
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: CompletePilotCheckpointDto,
  ) {
    return this.pilot.completeCheckpoint(user, code, dto);
  }

  @Post('checkpoints/:code/reopen')
  @RequirePermissions('PILOT_MANAGE')
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: ReopenPilotCheckpointDto,
  ) {
    return this.pilot.reopenCheckpoint(user, code, dto);
  }

  @Get('operations')
  @RequirePermissions('PILOT_READ')
  pilotOperations(@CurrentUser() user: AuthenticatedUser) {
    return this.operations.overview(user);
  }

  @Get('operations.csv')
  @RequirePermissions('PILOT_MANAGE')
  async pilotOperationsCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.operations.exportCsv(user);
    response.type('text/csv; charset=utf-8');
    response.attachment(csv.fileName);
    return csv.content;
  }

  @Patch('program')
  @RequirePermissions('PILOT_MANAGE')
  updateProgram(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePilotProgramDto) {
    return this.operations.updateProgram(user, dto);
  }

  @Post('program/transition')
  @RequirePermissions('PILOT_MANAGE')
  transitionProgram(@CurrentUser() user: AuthenticatedUser, @Body() dto: TransitionPilotProgramDto) {
    return this.operations.transitionProgram(user, dto);
  }

  @Post('program/cycles')
  @RequirePermissions('PILOT_MANAGE')
  startCycle(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartPilotCycleDto) {
    return this.operations.startCycle(user, dto);
  }

  @Post('participants')
  @RequirePermissions('PILOT_MANAGE')
  addParticipant(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddPilotParticipantDto) {
    return this.operations.addParticipant(user, dto);
  }

  @Post('participants/:id/training')
  @RequirePermissions('PILOT_MANAGE')
  confirmTraining(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmPilotTrainingDto,
  ) {
    return this.operations.confirmTraining(user, id, dto);
  }

  @Post('participants/:id/remove')
  @RequirePermissions('PILOT_MANAGE')
  removeParticipant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RemovePilotParticipantDto,
  ) {
    return this.operations.removeParticipant(user, id, dto.reason);
  }

  @Post('validations')
  @RequirePermissions('PILOT_MANAGE')
  addValidation(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePilotValidationDto) {
    return this.operations.addValidation(user, dto);
  }

  @Post('validations/:id/review')
  @RequirePermissions('PILOT_MANAGE')
  reviewValidation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewPilotValidationDto,
  ) {
    return this.operations.reviewValidation(user, id, dto);
  }

  @Post('issues')
  @RequirePermissions('PILOT_MANAGE')
  createIssue(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePilotIssueDto) {
    return this.operations.createIssue(user, dto);
  }

  @Patch('issues/:id')
  @RequirePermissions('PILOT_MANAGE')
  updateIssue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePilotIssueDto,
  ) {
    return this.operations.updateIssue(user, id, dto);
  }

  @Post('imports/preview')
  @RequirePermissions('PILOT_MANAGE')
  previewImport(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePilotImportDto) {
    return this.operations.previewImport(user, dto);
  }

  @Post('imports/:id/commit')
  @RequirePermissions('PILOT_MANAGE')
  commitImport(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.operations.commitImport(user, id);
  }

  @Post('imports/:id/cancel')
  @RequirePermissions('PILOT_MANAGE')
  cancelImport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelPilotImportDto,
  ) {
    return this.operations.cancelImport(user, id, dto);
  }
}
