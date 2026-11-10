import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DOCUMENT_VALIDITY_STATUSES = [
  'EXPIRED',
  'DUE_15',
  'DUE_30',
  'DUE_90',
  'CURRENT',
  'UNDATED',
] as const;

export type DocumentValidityStatus = (typeof DOCUMENT_VALIDITY_STATUSES)[number];

export class DocumentValidityQueryDto {
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @IsIn(DOCUMENT_VALIDITY_STATUSES)
  status?: DocumentValidityStatus;

  @IsOptional() @IsDateString()
  asOf?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(100)
  pageSize?: number;
}

export class UpdateDocumentValidityDto {
  @IsOptional() @IsDateString()
  issuedAt?: string | null;

  @IsOptional() @IsDateString()
  expiresAt?: string | null;
}
