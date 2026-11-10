import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class InsightRequestDto {
  @IsOptional()
  @IsIn(['local', 'ai'])
  mode?: 'local' | 'ai';

  @IsOptional()
  @IsUUID('4')
  conversationId?: string;
}
