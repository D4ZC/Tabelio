import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('operations')
  @RequirePermissions('REPORT_READ')
  operations(@CurrentUser() user: AuthenticatedUser, @Query() query: ReportQueryDto) {
    return this.reports.operations(user, query);
  }

  @Get('operations.csv')
  @RequirePermissions('REPORT_EXPORT')
  async operationsCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.reports.operationsCsv(user, query);
    response.type('text/csv; charset=utf-8');
    response.attachment(csv.fileName);
    return csv.content;
  }
}
