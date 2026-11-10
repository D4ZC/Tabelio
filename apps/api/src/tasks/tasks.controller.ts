import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import {
  AddTaskCommentDto,
  AddTaskDependencyDto,
  AddTaskEvidenceDto,
  ChangeTaskStatusDto,
  CreateTaskDto,
  RescheduleTaskDto,
  PendingTasksQueryDto,
  TaskDashboardQueryDto,
  TaskQueryDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { TasksService } from './tasks.service';

@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('tasks')
  @RequirePermissions('TASK_READ')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: TaskQueryDto) {
    return this.tasks.list(user, query, query.asOf ? new Date(query.asOf) : new Date());
  }

  @Get('tasks/pending-summary')
  @RequirePermissions('TASK_READ')
  pendingSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: PendingTasksQueryDto) {
    return this.tasks.pendingSummary(user, query, query.asOf ? new Date(query.asOf) : new Date());
  }

  @Get('tasks.csv')
  @RequirePermissions('REPORT_EXPORT')
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TaskQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.tasks.exportCsv(user, query, query.asOf ? new Date(query.asOf) : new Date());
    response.type('text/csv; charset=utf-8');
    response.attachment(csv.fileName);
    return csv.content;
  }

  @Get('tasks/dashboard')
  @RequirePermissions('TASK_READ')
  dashboard(@CurrentUser() user: AuthenticatedUser, @Query() query: TaskDashboardQueryDto) {
    return this.tasks.dashboard(user, query.asOf ? new Date(query.asOf) : new Date());
  }

  @Get('tasks/assignees')
  @RequirePermissions('TASK_READ')
  assignees(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.assignees(user);
  }

  @Post('tasks/document-validity/sync')
  @RequirePermissions('TASK_MANAGE')
  syncDocumentValidity(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TaskDashboardQueryDto,
  ) {
    return this.tasks.syncDocumentValidityTasks(
      user,
      query.asOf ? new Date(query.asOf) : new Date(),
    );
  }

  @Post('tasks/sla/sync')
  @RequirePermissions('TASK_MANAGE')
  syncSla(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TaskDashboardQueryDto,
  ) {
    return this.tasks.syncSlaEscalations(
      user,
      query.asOf ? new Date(query.asOf) : new Date(),
    );
  }

  @Post('matters/:matterId/tasks')
  @RequirePermissions('TASK_MANAGE')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(user, matterId, dto);
  }

  @Patch('tasks/:id')
  @RequirePermissions('TASK_MANAGE')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(user, id, dto);
  }

  @Post('tasks/:id/reschedule')
  @RequirePermissions('TASK_MANAGE')
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RescheduleTaskDto,
  ) {
    return this.tasks.reschedule(user, id, dto.dueAt, dto.reason);
  }

  @Post('tasks/:id/comments')
  @RequirePermissions('TASK_MANAGE')
  addComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddTaskCommentDto,
  ) {
    return this.tasks.addComment(user, id, dto.body);
  }

  @Post('tasks/:id/evidence')
  @RequirePermissions('TASK_MANAGE')
  addEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddTaskEvidenceDto,
  ) {
    return this.tasks.addEvidence(user, id, dto.documentId);
  }

  @Post('tasks/:id/dependencies')
  @RequirePermissions('TASK_MANAGE')
  addDependency(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddTaskDependencyDto,
  ) {
    return this.tasks.addDependency(user, id, dto.dependsOnTaskId);
  }

  @Delete('tasks/:id/dependencies/:dependencyId')
  @RequirePermissions('TASK_MANAGE')
  removeDependency(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('dependencyId') dependencyId: string,
  ) {
    return this.tasks.removeDependency(user, id, dependencyId);
  }

  @Post('tasks/:id/status')
  @RequirePermissions('TASK_MANAGE')
  changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeTaskStatusDto,
  ) {
    return this.tasks.changeStatus(user, id, dto.status, dto.reason);
  }
}
