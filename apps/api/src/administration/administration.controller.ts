import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AdministrationService } from './administration.service';
import { CreateMemberDto, UpdateMemberRoleDto } from './dto/member.dto';

@Controller('members')
export class AdministrationController {
  constructor(private readonly administration: AdministrationService) {}

  @Get()
  @RequirePermissions('MEMBER_READ')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.administration.listMembers(user);
  }

  @Post()
  @RequirePermissions('MEMBER_MANAGE')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMemberDto) {
    return this.administration.createMember(user, dto);
  }

  @Patch(':id/role')
  @RequirePermissions('MEMBER_MANAGE')
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.administration.updateRole(user, id, dto);
  }
}

