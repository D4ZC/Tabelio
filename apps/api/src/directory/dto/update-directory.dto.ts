import { PersonType } from '@despacho/database';
import { IsDateString, IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdatePersonDto {
  @IsOptional() @IsEnum(PersonType) type?: PersonType;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() givenName?: string;
  @IsOptional() @IsString() familyName?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() birthPlaceCity?: string;
  @IsOptional() @IsString() birthPlaceState?: string;
  @IsOptional() @IsString() birthPlaceCountry?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() maritalStatus?: string;
  @IsOptional() @IsString() occupation?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() curp?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() identificationType?: string;
  @IsOptional() @IsString() identificationNumber?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdatePropertyDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() useType?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() cadastralReference?: string;
  @IsOptional() @IsString() registryReference?: string;
  @IsOptional() @IsString() ownershipEvidence?: string;
  @IsOptional() @IsString() ownerPersonId?: string;
  @IsOptional() @IsString() notes?: string;
}
