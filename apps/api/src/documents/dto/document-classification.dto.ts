import { DocumentType } from '@despacho/database';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateDocumentClassificationDto {
  @IsOptional() @IsEnum(DocumentType)
  type?: DocumentType;

  @IsOptional() @IsString()
  personId?: string | null;

  @IsOptional() @IsString()
  propertyId?: string | null;
}
