import { MatterKind, MatterStatus } from '@despacho/database';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListMattersQueryDto {
  @IsOptional()
  @IsEnum(MatterStatus)
  status?: MatterStatus;

  @IsOptional()
  @IsEnum(MatterKind)
  kind?: MatterKind;

  /** Busca en referencia, título, notas, número de convenio, inmueble y nombres de las partes. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  /** `options`: sólo los campos necesarios para selectores (respuesta ligera). */
  @IsOptional()
  @IsIn(['options'])
  view?: 'options';
}
