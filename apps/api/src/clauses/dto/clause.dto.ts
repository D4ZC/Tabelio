import { MatterKind } from '@despacho/database';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateClauseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsEnum(MatterKind)
  matterKind!: MatterKind;

  @IsString()
  @MinLength(20)
  @MaxLength(20_000)
  body!: string;
}

export class CreateClauseVersionDto {
  @IsString()
  @MinLength(20)
  @MaxLength(20_000)
  body!: string;
}

export class SelectMatterClausesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  clauseVersionIds!: string[];
}

export class ClauseQueryDto {
  @IsOptional()
  @IsEnum(MatterKind)
  matterKind?: MatterKind;
}
