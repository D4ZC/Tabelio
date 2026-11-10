import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class LibraryQueryDto {
  @IsOptional() @IsString() @MaxLength(200)
  q?: string;

  @IsOptional() @IsString() @MaxLength(100)
  source?: string;

  @IsOptional() @IsString() @MaxLength(100)
  documentType?: string;

  @IsOptional() @IsString() @MaxLength(100)
  legalFamily?: string;

  @IsOptional() @IsString() @MaxLength(100)
  usage?: string;

  @IsOptional() @IsString() @MaxLength(200)
  variant?: string;

  @IsOptional() @IsString() @MaxLength(200)
  packageId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}
