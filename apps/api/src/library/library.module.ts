import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

@Module({
  imports: [DocumentsModule],
  controllers: [LibraryController],
  providers: [LibraryService],
})
export class LibraryModule {}
