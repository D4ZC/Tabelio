import { IsOptional, IsString } from 'class-validator';

export class CreatePropertyDto {
  @IsString() displayName!: string;
  @IsOptional() @IsString() useType?: string;
  @IsString() addressLine1!: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsString() city!: string;
  @IsString() state!: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() cadastralReference?: string;
  @IsOptional() @IsString() registryReference?: string;
  @IsOptional() @IsString() ownershipEvidence?: string;
  @IsOptional() @IsString() ownerPersonId?: string;
  @IsOptional() @IsString() notes?: string;
}

