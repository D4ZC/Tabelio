import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AttachLibraryDocumentDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  matterId!: string;

  @IsOptional() @IsBoolean()
  includePackage?: boolean;
}
