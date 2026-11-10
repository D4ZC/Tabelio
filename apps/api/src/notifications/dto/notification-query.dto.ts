import { IsDateString, IsOptional, IsString } from 'class-validator';

export class NotificationQueryDto {
  @IsOptional()
  @IsString()
  matterId?: string;

  @IsOptional()
  @IsDateString()
  asOf?: string;
}
