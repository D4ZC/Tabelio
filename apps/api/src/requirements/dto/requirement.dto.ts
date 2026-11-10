import { MatterKind, MatterPartyRole } from '@despacho/database';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RequirementQueryDto {
  @IsOptional() @IsEnum(MatterKind)
  matterKind?: MatterKind;
}

export class CreateRequirementDto {
  @IsString() @MinLength(2) @MaxLength(40)
  code!: string;

  @IsString() @MinLength(3) @MaxLength(180)
  label!: string;

  @IsEnum(MatterKind)
  matterKind!: MatterKind;

  @IsBoolean()
  blocking!: boolean;

  @IsOptional() @IsEnum(MatterPartyRole)
  appliesToRole?: MatterPartyRole;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000)
  sortOrder?: number;
}

export class UpdateRequirementDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(180)
  label?: string;

  @IsOptional() @IsBoolean()
  blocking?: boolean;

  @IsOptional() @IsEnum(MatterPartyRole)
  appliesToRole?: MatterPartyRole | null;

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000)
  sortOrder?: number;
}
