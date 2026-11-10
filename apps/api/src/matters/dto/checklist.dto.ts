import { IsIn, IsString, MinLength } from 'class-validator';

export class WaiveChecklistItemDto {
  @IsString()
  @MinLength(10)
  reason!: string;
}

export class SetManualChecklistStatusDto {
  @IsIn(['PENDING', 'COMPLETE'])
  status!: 'PENDING' | 'COMPLETE';
}
