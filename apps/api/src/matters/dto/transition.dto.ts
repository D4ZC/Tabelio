import { MatterStatus } from '@despacho/database';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class TransitionMatterDto {
  @IsEnum(MatterStatus)
  status!: MatterStatus;

  @IsOptional()
  @IsString()
  comment?: string;
}

