import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class StartTerminationDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}

export class CancelTerminationDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}

export class CompleteTerminationDto {
  @IsDateString()
  closedAt!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  comment!: string;
}
