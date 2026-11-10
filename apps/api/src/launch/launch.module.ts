import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { LaunchController } from './launch.controller';
import { LaunchService } from './launch.service';

@Module({
  imports: [DocumentsModule],
  controllers: [LaunchController],
  providers: [LaunchService],
})
export class LaunchModule {}
