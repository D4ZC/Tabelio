import type { InsightAiResult, InsightKind } from './insight-ai.service';

export interface InsightOptions {
  mode?: 'local' | 'ai';
  conversationId?: string;
}

export interface InsightResult extends Omit<InsightAiResult, 'suggestedDocumentKind'> {
  kind: InsightKind;
  mode: 'local' | 'ai';
  generatedAt: string;
  sources: Array<{ id: string; label: string }>;
  limitations: string[];
  suggestion?: { documentType: 'LANDLORD_ID' | 'TENANT_ID' | 'GUARANTOR_ID' | 'PROOF_OF_ADDRESS' | 'OTHER' };
  facts?: Record<string, unknown>;
}
