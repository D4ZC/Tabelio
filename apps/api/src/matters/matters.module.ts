import { Module } from '@nestjs/common';
import { RequirementsModule } from '../requirements/requirements.module';
import { MattersController } from './matters.controller';
import { MattersService } from './matters.service';

@Module({
  imports: [RequirementsModule],
  controllers: [MattersController],
  providers: [MattersService],
  exports: [MattersService],
})
export class MattersModule {}
