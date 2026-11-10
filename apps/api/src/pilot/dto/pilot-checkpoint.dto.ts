import { IsString, MaxLength, MinLength } from 'class-validator';

export class CompletePilotCheckpointDto {
  @IsString() @MinLength(10) @MaxLength(2000)
  evidence!: string;
}

export class ReopenPilotCheckpointDto {
  @IsString() @MinLength(10) @MaxLength(1000)
  reason!: string;
}
