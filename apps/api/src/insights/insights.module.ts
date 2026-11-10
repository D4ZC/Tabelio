import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { MattersModule } from '../matters/matters.module';
import { AssistantProviderService } from '../assistant/assistant-provider.service';
import { DocumentClassificationService } from './document-classification.service';
import { DocumentComparisonService } from './document-comparison.service';
import { InsightAiService } from './insight-ai.service';
import { InsightsController } from './insights.controller';
import { MatterInsightsService } from './matter-insights.service';

@Module({
  imports: [DocumentsModule, MattersModule],
  providers: [AssistantProviderService, InsightAiService, MatterInsightsService, DocumentComparisonService, DocumentClassificationService],
  controllers: [InsightsController],
})
export class InsightsModule {}
