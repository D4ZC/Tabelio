import { Module } from '@nestjs/common';
import { ObjectStorageService } from '../documents/object-storage.service';
import { MattersModule } from '../matters/matters.module';
import { TasksModule } from '../tasks/tasks.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [MattersModule, TasksModule],
  controllers: [PortalController],
  providers: [PortalService, ObjectStorageService],
})
export class PortalModule {}
