import { IsString, MaxLength, MinLength } from 'class-validator';

export class DocumentReviewDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  comment!: string;
}
