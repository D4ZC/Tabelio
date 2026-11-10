import {
  PersonType,
  PilotIssueSeverity,
  PilotIssueStatus,
  PilotProgramStatus,
  PilotValidationResult,
} from '@despacho/database';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class UpdatePilotProgramDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120)
  name?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  targetCases?: number;
}

export class StartPilotCycleDto {
  @IsString() @MinLength(3) @MaxLength(120)
  name!: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(500)
  targetCases!: number;

  @IsString() @MinLength(10) @MaxLength(1000)
  reason!: string;
}

export class TransitionPilotProgramDto {
  @IsEnum(PilotProgramStatus)
  status!: PilotProgramStatus;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  rolloutPercentage?: number;

  @IsString() @MinLength(10) @MaxLength(1000)
  comment!: string;
}

export class AddPilotParticipantDto {
  @IsString() @MinLength(1) @MaxLength(100)
  membershipId!: string;
}

export class ConfirmPilotTrainingDto {
  @IsString() @MinLength(10) @MaxLength(2000)
  evidence!: string;
}

export class RemovePilotParticipantDto {
  @IsString() @MinLength(10) @MaxLength(1000)
  reason!: string;
}

export class CreatePilotValidationDto {
  @IsString() @MinLength(1) @MaxLength(100)
  matterId!: string;

  @IsOptional() @IsString() @MaxLength(120)
  legacyReference?: string;
}

export class ReviewPilotValidationDto {
  @IsEnum(PilotValidationResult)
  result!: PilotValidationResult;

  @IsString() @MinLength(10) @MaxLength(3000)
  notes!: string;
}

export class CreatePilotIssueDto {
  @IsString() @MinLength(2) @MaxLength(80)
  category!: string;

  @IsEnum(PilotIssueSeverity)
  severity!: PilotIssueSeverity;

  @IsString() @MinLength(5) @MaxLength(180)
  title!: string;

  @IsString() @MinLength(10) @MaxLength(5000)
  description!: string;

  @IsOptional() @IsString() @MaxLength(100)
  matterId?: string;

  @IsOptional() @IsString() @MaxLength(100)
  assignedMembershipId?: string;
}

export class UpdatePilotIssueDto {
  @IsEnum(PilotIssueStatus)
  status!: PilotIssueStatus;

  @IsOptional() @IsString() @MaxLength(5000)
  resolution?: string;

  @IsOptional() @IsString() @MaxLength(100)
  assignedMembershipId?: string;
}

export class PilotImportPersonDto {
  @IsEnum(PersonType)
  type!: PersonType;

  @IsString() @MinLength(2) @MaxLength(200)
  legalName!: string;

  @IsOptional() @IsString() @MaxLength(40)
  taxId?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(250)
  addressLine1?: string;

  @IsOptional() @IsString() @MaxLength(120)
  city?: string;

  @IsOptional() @IsString() @MaxLength(120)
  state?: string;

  @IsOptional() @IsString() @MaxLength(20)
  postalCode?: string;

  @IsOptional() @IsString() @MaxLength(120)
  country?: string;

  @IsOptional() @IsString() @MaxLength(80)
  identificationType?: string;

  @IsOptional() @IsString() @MaxLength(120)
  identificationNumber?: string;
}

export class CreatePilotImportDto {
  @IsString() @MinLength(3) @MaxLength(180)
  sourceName!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => PilotImportPersonDto)
  people!: PilotImportPersonDto[];
}

export class CancelPilotImportDto {
  @IsString() @MinLength(10) @MaxLength(1000)
  reason!: string;
}
