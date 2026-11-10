import { DocumentType } from '@despacho/database';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class UploadDocumentDto {
  @IsEnum(DocumentType)
  type!: DocumentType;

  @IsOptional() @IsString() personId?: string;
  @IsOptional() @IsString() propertyId?: string;

  @Transform(({ value }) => value === '' ? undefined : value)
  @IsOptional() @IsDateString()
  issuedAt?: string;

  @Transform(({ value }) => value === '' ? undefined : value)
  @IsOptional() @IsDateString()
  expiresAt?: string;
}
