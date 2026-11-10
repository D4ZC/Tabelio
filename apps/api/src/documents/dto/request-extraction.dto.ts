import { IsIn, IsOptional } from 'class-validator';
import type { DocumentExtractionMode } from '../extraction/document-extraction.port';

export class RequestExtractionDto {
  @IsOptional()
  @IsIn(['local', 'ai', 'manual'])
  mode?: DocumentExtractionMode;
}
