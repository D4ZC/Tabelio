import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('events')
  @RequirePermissions('AUDIT_READ')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: AuditQueryDto) {
    return this.audit.list(user, query);
  }

  @Get('events.csv')
  @RequirePermissions('AUDIT_EXPORT')
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AuditQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.audit.exportCsv(user, query);
    response.type('text/csv; charset=utf-8');
    response.attachment(csv.fileName);
    return csv.content;
  }
}
