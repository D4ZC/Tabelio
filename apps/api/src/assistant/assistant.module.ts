import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantMcpService } from './assistant-mcp.service';
import { AssistantProviderService } from './assistant-provider.service';
import { AssistantService } from './assistant.service';
import { DocumentsModule } from '../documents/documents.module';
import { AssistantAttachmentsService } from './assistant-attachments.service';

@Module({
  imports: [DocumentsModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantProviderService, AssistantMcpService, AssistantAttachmentsService],
})
export class AssistantModule {}
