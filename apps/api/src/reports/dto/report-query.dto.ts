import { IsDateString, IsOptional } from 'class-validator';

export class ReportQueryDto {
  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @IsDateString()
  asOf?: string;
}
