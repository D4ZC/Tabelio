import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AssistantMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  content!: string;
}

export class AssistantContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  pathname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;
}

export class AssistantChatDto {
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  attachmentIds?: string[];

  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => AssistantMessageDto)
  messages!: AssistantMessageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantContextDto)
  context?: AssistantContextDto;

  @IsOptional()
  @IsUUID()
  continuationId?: string;
}

export class ResolveAssistantActionDto {
  @IsBoolean()
  approved!: boolean;
}

export class AssistantConversationQueryDto {
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;

  @IsOptional()
  @IsIn(['local', 'ai'])
  extractionMode?: 'local' | 'ai';
}
