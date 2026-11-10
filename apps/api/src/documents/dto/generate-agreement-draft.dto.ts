import { IsDateString } from 'class-validator';

export class GenerateAgreementDraftDto {
  @IsDateString()
  leaseExecutionDate!: string;
}
