import { MatterKind } from '@despacho/database';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateMatterDto {
  @IsString()
  title!: string;

  @IsEnum(MatterKind)
  kind!: MatterKind;

  @IsOptional() @IsString() propertyId?: string;
  @IsOptional() @IsString() guaranteePropertyId?: string;
  @IsOptional() @IsString() linkedMatterId?: string;
  @IsOptional() @IsString() responsibleMembershipId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateMatterDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() propertyId?: string;
  @IsOptional() @IsString() guaranteePropertyId?: string;
  @IsOptional() @IsString() linkedMatterId?: string;
  @IsOptional() @IsString() notes?: string;
}
