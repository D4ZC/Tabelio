import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpsertLeaseTermsDto {
  @Type(() => Number) @IsNumber() @Min(0) rentAmount!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) depositAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) prepaidRentAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) totalInitialPayment?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31) dueDay?: number;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsBoolean() maintenanceIncluded?: boolean;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) durationMonths?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) noticeDays?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) lateFeePercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) holdoverSurchargePercent?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) earlyTerminationPenaltyMonths?: number;
}

export class UpsertMediationTermsDto {
  @IsOptional() @IsString() agreementNumber?: string;
  @IsOptional() @IsString() caseFileNumber?: string;
  @IsOptional() @IsDateString() hearingAt?: string;
  @IsOptional() @IsString() centerName?: string;
  @IsOptional() @IsString() centerAccreditationNumber?: string;
  @IsOptional() @IsString() facilitatorName?: string;
  @IsOptional() @IsString() facilitatorCertification?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) certifiedCopies?: number;
}

