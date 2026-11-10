import { TaskPriority, TaskStatus } from '@despacho/database';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class TaskQueryDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  q?: string;

  @IsOptional() @IsString() matterId?: string;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsIn(['OVERDUE', 'TODAY', 'NEXT_7_DAYS', 'NO_DUE_DATE'])
  due?: 'OVERDUE' | 'TODAY' | 'NEXT_7_DAYS' | 'NO_DUE_DATE';
  @IsOptional() @IsString() assignee?: string;
  @IsOptional() @IsDateString() asOf?: string;
}

export class TaskDashboardQueryDto {
  @IsOptional() @IsDateString() asOf?: string;
}

export class PendingTasksQueryDto extends TaskDashboardQueryDto {
  @IsOptional() @IsString() assignee?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) q?: string;
}

export class CreateTaskDto {
  @IsString() @MinLength(3) @MaxLength(160)
  title!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional() @IsDateString()
  dueAt?: string;

  @IsOptional() @IsString()
  assigneeMembershipId?: string;

  @IsOptional() @IsBoolean()
  requiresEvidence?: boolean;
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(160)
  title?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string | null;

  @IsOptional() @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional() @IsString()
  assigneeMembershipId?: string | null;

  @IsOptional() @IsBoolean()
  requiresEvidence?: boolean;
}

export class AddTaskEvidenceDto {
  @IsString()
  documentId!: string;
}

export class AddTaskDependencyDto {
  @IsString()
  dependsOnTaskId!: string;
}

export class RescheduleTaskDto {
  @IsDateString()
  dueAt!: string;

  @IsString() @MinLength(10) @MaxLength(1000)
  reason!: string;
}

export class AddTaskCommentDto {
  @IsString() @MinLength(3) @MaxLength(2000)
  body!: string;
}

export class ChangeTaskStatusDto {
  @IsEnum(TaskStatus)
  status!: TaskStatus;

  @IsOptional() @IsString() @MinLength(10) @MaxLength(1000)
  reason?: string;
}
