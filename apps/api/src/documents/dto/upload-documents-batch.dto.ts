import { IsString } from 'class-validator';

export class UploadDocumentsBatchDto {
  @IsString()
  metadata!: string;
}
