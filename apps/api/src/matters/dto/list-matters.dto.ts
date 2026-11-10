import { MatterKind, MatterStatus } from '@despacho/database';
import { IsEnum, IsOptional } from 'class-validator';

export class ListMattersQueryDto {
  @IsOptional()
  @IsEnum(MatterStatus)
  status?: MatterStatus;

  @IsOptional()
  @IsEnum(MatterKind)
  kind?: MatterKind;
}
