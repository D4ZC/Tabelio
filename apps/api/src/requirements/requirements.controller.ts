import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import {
  CreateRequirementDto,
  RequirementQueryDto,
  UpdateRequirementDto,
} from './dto/requirement.dto';
import { RequirementsService } from './requirements.service';

@Controller('requirements')
export class RequirementsController {
  constructor(private readonly requirements: RequirementsService) {}

  @Get()
  @RequirePermissions('REQUIREMENT_READ')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: RequirementQueryDto) {
    return this.requirements.list(user, query.matterKind);
  }

  @Post()
  @RequirePermissions('REQUIREMENT_MANAGE')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRequirementDto) {
    return this.requirements.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('REQUIREMENT_MANAGE')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.requirements.update(user, id, dto);
  }
}
