import { ExtractionReviewDecision } from '@despacho/database';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IDENTITY_FIELDS } from '../extraction/identity-fields';

export class ExtractionQueueQueryDto {
  @IsOptional() @IsString() @MaxLength(100) documentId?: string;
  @IsOptional() @IsIn(['PENDING_REVIEW', 'REVIEWED', 'ALL'])
  state?: 'PENDING_REVIEW' | 'REVIEWED' | 'ALL';

  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(100)
  pageSize?: number;
}

export class ReviewExtractionDto {
  @IsOptional() @IsString() @MaxLength(100) personId?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(13) @ArrayUnique() @IsIn(IDENTITY_FIELDS, { each: true })
  personFields?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(13) @ArrayUnique() @IsIn(IDENTITY_FIELDS, { each: true })
  overwritePersonFields?: string[];

  @IsOptional() @IsObject()
  expectedPersonValues?: Record<string, unknown>;
  @IsEnum(ExtractionReviewDecision)
  decision!: ExtractionReviewDecision;

  @IsOptional() @IsObject()
  data?: Record<string, unknown>;

  @IsString() @MinLength(10) @MaxLength(2000)
  comment!: string;
}
