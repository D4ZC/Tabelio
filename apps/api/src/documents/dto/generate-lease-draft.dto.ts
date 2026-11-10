import { IsDateString } from 'class-validator';

export class GenerateLeaseDraftDto {
  @IsDateString()
  executionDate!: string;
}
