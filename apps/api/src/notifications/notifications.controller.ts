import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions('MATTER_READ')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationQueryDto,
  ) {
    return this.notifications.list(
      user,
      query.matterId,
      query.asOf ? new Date(query.asOf) : new Date(),
    );
  }

  @Get('inbox')
  @RequirePermissions('MATTER_READ')
  inbox(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.listInbox(user);
  }

  @Post('sync')
  @RequirePermissions('NOTIFICATION_MANAGE')
  sync(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.syncOrganization(user);
  }

  @Post(':id/acknowledge')
  @RequirePermissions('MATTER_READ')
  acknowledge(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.acknowledge(user, id);
  }
}
