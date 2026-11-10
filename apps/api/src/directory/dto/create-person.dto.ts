import { PersonType } from '@despacho/database';
import { IsDateString, IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreatePersonDto {
  @IsEnum(PersonType)
  type: PersonType = PersonType.INDIVIDUAL;

  @IsString()
  legalName!: string;

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
