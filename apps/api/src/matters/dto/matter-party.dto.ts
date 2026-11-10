import { MatterPartyRole } from '@despacho/database';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class AddMatterPartyDto {
  @IsString()
  personId!: string;

  @IsEnum(MatterPartyRole)
  role!: MatterPartyRole;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

