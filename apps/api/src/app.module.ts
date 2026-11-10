import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { resolve } from 'node:path';
import { AuditModule } from './audit/audit.module';
import { AdministrationModule } from './administration/administration.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { DirectoryModule } from './directory/directory.module';
import { DocumentsModule } from './documents/documents.module';
import { MattersModule } from './matters/matters.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { ClausesModule } from './clauses/clauses.module';
import { PortalModule } from './portal/portal.module';
import { TasksModule } from './tasks/tasks.module';
import { ReportsModule } from './reports/reports.module';
import { RequirementsModule } from './requirements/requirements.module';
import { SearchModule } from './search/search.module';
import { PilotModule } from './pilot/pilot.module';
import { LaunchModule } from './launch/launch.module';
import { validateRuntimeConfig } from './config/runtime-config';
import { McpModule } from './mcp/mcp.module';
import { AssistantModule } from './assistant/assistant.module';
import { AiUsageModule } from './ai-usage/ai-usage.module';
import { UsageCorrelationInterceptor } from './ai-usage/usage-correlation.interceptor';
import { InsightsModule } from './insights/insights.module';
import { LibraryModule } from './library/library.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // npm workspaces executes this package with `apps/api` as cwd, while the shared
      // development configuration lives at the repository root. Keep a package-local
      // file as the highest-priority override and use the root file as the fallback.
      envFilePath: ['.env', resolve(__dirname, '../../../.env')],
      // Resolve secret indirections from the process environment without persisting them.
      expandVariables: true,
      validate: validateRuntimeConfig,
    }),
    PrismaModule,
    AiUsageModule,
    AdministrationModule,
    AuthModule,
    AuditModule,
    NotificationsModule,
    ClausesModule,
    PortalModule,
    TasksModule,
    ReportsModule,
    RequirementsModule,
    SearchModule,
    PilotModule,
    LaunchModule,
    McpModule,
    AssistantModule,
    DirectoryModule,
    DocumentsModule,
    MattersModule,
    InsightsModule,
    LibraryModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: UsageCorrelationInterceptor },
  ],
})
export class AppModule {}
