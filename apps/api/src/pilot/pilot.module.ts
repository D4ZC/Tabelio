import { Module } from '@nestjs/common';
import { PilotController } from './pilot.controller';
import { PilotOperationsService } from './pilot-operations.service';
import { PilotService } from './pilot.service';

@Module({ controllers: [PilotController], providers: [PilotService, PilotOperationsService] })
export class PilotModule {}
