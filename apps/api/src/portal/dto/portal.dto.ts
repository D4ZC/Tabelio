import { DocumentType, MatterPartyRole, PersonType } from '@despacho/database';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePortalInvitationDto {
  @IsEnum(MatterPartyRole)
  partyRole!: MatterPartyRole;

  @IsOptional() @IsEmail() invitedEmail?: string;
  @IsOptional() @IsString() personId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(30) expiresInDays = 7;
}

export class SavePortalIntakeDto {
  @IsOptional() @IsEnum(PersonType) type?: PersonType;
  @IsOptional() @IsString() @MaxLength(240) legalName?: string;
  @IsOptional() @IsString() @MaxLength(120) givenName?: string;
  @IsOptional() @IsString() @MaxLength(160) familyName?: string;
  @IsOptional() @IsString() @MaxLength(40) gender?: string;
  @IsOptional() @IsString() @MaxLength(80) nationality?: string;
  @IsOptional() @IsString() @MaxLength(120) birthPlaceCity?: string;
  @IsOptional() @IsString() @MaxLength(120) birthPlaceState?: string;
  @IsOptional() @IsString() @MaxLength(120) birthPlaceCountry?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(80) maritalStatus?: string;
  @IsOptional() @IsString() @MaxLength(160) occupation?: string;
  @IsOptional() @IsString() @MaxLength(32) taxId?: string;
  @IsOptional() @IsEmail() @MaxLength(240) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(240) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(240) addressLine2?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(120) state?: string;
  @IsOptional() @IsString() @MaxLength(16) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(80) identificationType?: string;
  @IsOptional() @IsString() @MaxLength(120) identificationNumber?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class PortalUploadDto {
  @IsEnum(DocumentType)
  type!: DocumentType;
}

export class ReviewPortalSubmissionDto {
  @IsString() @MinLength(10) @MaxLength(2000)
  comment!: string;
}
