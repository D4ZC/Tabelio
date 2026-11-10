import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SearchQueryDto {
  @IsString() @MinLength(2) @MaxLength(100)
  q!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(25)
  limit?: number;
}
