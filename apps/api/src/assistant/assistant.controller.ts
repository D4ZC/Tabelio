import { Body, Controller, Delete, Param, Post, Query, Req, UnauthorizedException, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { extractSessionToken } from '../auth/session-token';
import { AssistantService } from './assistant.service';
import { AssistantChatDto, AssistantConversationQueryDto, ResolveAssistantActionDto } from './dto/assistant.dto';
import { AssistantAttachmentsService } from './assistant-attachments.service';
import { RequirePermissions } from '../auth/permissions.decorator';

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly attachments: AssistantAttachmentsService,
  ) {}

  @Post('attachments')
  @RequirePermissions('DOCUMENT_WRITE')
  @UseInterceptors(FilesInterceptor('files', 3, { limits: { fileSize: 20 * 1024 * 1024, files: 3, fields: 0 } }))
  uploadAttachments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AssistantConversationQueryDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.attachments.stage(user, files, query.conversationId, query.extractionMode ?? 'local');
  }

  @Delete('attachments/:id')
  @RequirePermissions('DOCUMENT_WRITE')
  discardAttachment(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attachments.discard(id, user);
  }

  @Post('chat')
  chat(
    @Body() dto: AssistantChatDto,
    @Req() request: Request,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assistant.chat(dto, user, this.accessToken(request));
  }

  @Post('actions/:id')
  resolveAction(
    @Param('id') id: string,
    @Body() dto: ResolveAssistantActionDto,
    @Req() request: Request,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assistant.resolveAction(id, dto.approved, user, this.accessToken(request));
  }

  private accessToken(request: Request) {
    const token = extractSessionToken(request);
    if (!token) throw new UnauthorizedException('Falta una sesión válida.');
    return token;
  }
}
