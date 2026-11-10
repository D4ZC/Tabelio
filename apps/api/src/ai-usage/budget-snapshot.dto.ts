import { Type } from 'class-transformer';
import {
  Equals, IsIn, IsISO8601, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf, ValidateNested,
} from 'class-validator';

export const SNAPSHOT_DECIMAL = /^\d{1,12}(?:\.\d{1,12})?$/;

export class DesktopBudgetTeamDto {
  @IsString()
  @MaxLength(160)
  label!: string;

  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(SNAPSHOT_DECIMAL)
  limit!: string | null;

  @IsString()
  @Matches(SNAPSHOT_DECIMAL)
  spent!: string;

  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @IsISO8601({ strict: true, strictSeparator: true })
  @MaxLength(35)
  resetAt!: string | null;
}

/** Only numeric display data is accepted. IBM cookies, credentials and URLs never enter this payload. */
export class DesktopBudgetSnapshotDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,128}$/)
  teamId!: string;

  @IsIn(['individual', 'shared'])
  scope!: 'individual' | 'shared';

  @Equals('Advantage Credits')
  currency!: 'Advantage Credits';

  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(SNAPSHOT_DECIMAL)
  limit!: string | null;

  @IsString()
  @Matches(SNAPSHOT_DECIMAL)
  spent!: string;

  @IsString()
  @IsISO8601({ strict: true, strictSeparator: true })
  @MaxLength(35)
  updatedAt!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DesktopBudgetTeamDto)
  team?: DesktopBudgetTeamDto;
}
