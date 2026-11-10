import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AuditQueryDto {
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @IsString() @MaxLength(100)
  action?: string;

  @IsOptional() @IsString() @MaxLength(80)
  entityType?: string;

  @IsOptional() @IsString() @MaxLength(40)
  actorUserId?: string;

  @IsOptional() @IsString() @MaxLength(40)
  matterId?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(100)
  pageSize?: number;
}
