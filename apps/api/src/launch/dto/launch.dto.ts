import {
  LaunchIntegrationKind,
  LaunchProgramStatus,
  LaunchTargetEnvironment,
  LaunchUatCategory,
  LaunchUatStatus,
} from '@despacho/database';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateLaunchProgramDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MinLength(10) @MaxLength(2000)
  scope?: string;

  @IsOptional() @IsEnum(LaunchTargetEnvironment)
  targetEnvironment?: LaunchTargetEnvironment;
}

export class StartLaunchCycleDto {
  @IsString() @MinLength(3) @MaxLength(120)
  name!: string;

  @IsString() @MinLength(10) @MaxLength(2000)
  scope!: string;

  @IsEnum(LaunchTargetEnvironment)
  targetEnvironment!: LaunchTargetEnvironment;

  @IsString() @MinLength(10) @MaxLength(1000)
  reason!: string;
}

export class CreateLaunchUatCaseDto {
  @IsString() @MinLength(5) @MaxLength(180)
  title!: string;

  @IsEnum(LaunchUatCategory)
  category!: LaunchUatCategory;

  @IsString() @MinLength(10) @MaxLength(3000)
  expectedResult!: string;

  @IsOptional() @IsString() @MaxLength(100)
  matterId?: string;

  @IsOptional() @IsString() @MaxLength(100)
  assignedMembershipId?: string;
}

export class ReviewLaunchUatCaseDto {
  @IsEnum(LaunchUatStatus)
  status!: LaunchUatStatus;

  @IsOptional() @IsString() @MaxLength(5000)
  actualResult?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  evidence?: string;
}

export class RunLaunchIntegrationDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  provider?: string;

  @IsOptional() @Type(() => Boolean) @IsBoolean()
  externalVerified?: boolean;

  @IsOptional() @IsString() @MaxLength(3000)
  evidence?: string;
}

export class CompleteLaunchControlDto {
  @IsString() @MinLength(10) @MaxLength(3000)
  evidence!: string;
}

export class ReopenLaunchControlDto {
  @IsString() @MinLength(10) @MaxLength(1000)
  reason!: string;
}

export class SubmitLaunchReviewDto {
  @IsString() @MinLength(10) @MaxLength(2000)
  comment!: string;
}

export class DecideLaunchDto {
  @IsEnum(LaunchProgramStatus)
  decision!: LaunchProgramStatus;

  @IsString() @MinLength(10) @MaxLength(3000)
  rationale!: string;
}

export class LaunchIntegrationPathDto {
  @IsEnum(LaunchIntegrationKind)
  kind!: LaunchIntegrationKind;
}
