import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class StartSignatureDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CompleteSignatureDto {
  @IsDateString()
  signedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CancelSignatureDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  comment!: string;
}
