import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { ClausesService } from './clauses.service';
import {
  ClauseQueryDto,
  CreateClauseDto,
  CreateClauseVersionDto,
  SelectMatterClausesDto,
} from './dto/clause.dto';

@Controller()
export class ClausesController {
  constructor(private readonly clauses: ClausesService) {}

  @Get('clauses')
  @RequirePermissions('CLAUSE_READ')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ClauseQueryDto) {
    return this.clauses.list(user, query.matterKind);
  }

  @Post('clauses')
  @RequirePermissions('CLAUSE_MANAGE')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateClauseDto) {
    return this.clauses.create(user, dto);
  }

  @Post('clauses/:clauseId/versions')
  @RequirePermissions('CLAUSE_MANAGE')
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clauseId') clauseId: string,
    @Body() dto: CreateClauseVersionDto,
  ) {
    return this.clauses.createVersion(user, clauseId, dto);
  }

  @Post('clauses/:clauseId/versions/:versionId/approve')
  @RequirePermissions('CLAUSE_APPROVE')
  approveVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clauseId') clauseId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.clauses.approveVersion(user, clauseId, versionId);
  }

  @Get('matters/:matterId/clauses')
  @RequirePermissions('MATTER_READ')
  listMatterSelections(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
  ) {
    return this.clauses.listMatterSelections(user, matterId);
  }

  @Put('matters/:matterId/clauses')
  @RequirePermissions('CLAUSE_SELECT')
  selectForMatter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Body() dto: SelectMatterClausesDto,
  ) {
    return this.clauses.selectForMatter(user, matterId, dto);
  }
}
