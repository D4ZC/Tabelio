import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CreateMatterDto, UpdateMatterDto } from './dto/create-matter.dto';
import { SetManualChecklistStatusDto, WaiveChecklistItemDto } from './dto/checklist.dto';
import { AddMatterPartyDto } from './dto/matter-party.dto';
import { UpsertLeaseTermsDto, UpsertMediationTermsDto } from './dto/terms.dto';
import { TransitionMatterDto } from './dto/transition.dto';
import { CreateRenewalDto, DashboardQueryDto } from './dto/renewal.dto';
import { MattersService } from './matters.service';
import { CancelMatterDto } from './dto/cancel-matter.dto';
import { AssignMatterResponsibleDto } from './dto/assign-responsible.dto';
import { ListMattersQueryDto } from './dto/list-matters.dto';

@Controller('matters')
export class MattersController {
  constructor(private readonly matters: MattersService) {}

  @Get()
  @RequirePermissions('MATTER_READ')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMattersQueryDto,
  ) {
    return query.view === 'options' ? this.matters.listOptions(user, query) : this.matters.list(user, query);
  }

  @Get('page')
  @RequirePermissions('MATTER_READ')
  page(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMattersQueryDto,
  ) {
    return this.matters.page(user, query);
  }

  @Get('dashboard')
  @RequirePermissions('MATTER_READ')
  dashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.matters.dashboard(user, query.asOf ? new Date(query.asOf) : new Date());
  }

  @Get(':id')
  @RequirePermissions('MATTER_READ')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.matters.get(user, id);
  }

  @Post()
  @RequirePermissions('MATTER_WRITE')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMatterDto) {
    return this.matters.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('MATTER_WRITE')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMatterDto,
  ) {
    return this.matters.update(user, id, dto);
  }

  @Patch(':id/responsible')
  @RequirePermissions('MATTER_WRITE')
  assignResponsible(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignMatterResponsibleDto,
  ) {
    return this.matters.assignResponsible(user, id, dto.responsibleMembershipId);
  }

  @Post(':id/parties')
  @RequirePermissions('MATTER_WRITE')
  addParty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddMatterPartyDto,
  ) {
    return this.matters.addParty(user, id, dto);
  }

  @Post(':id/lease-terms')
  @RequirePermissions('MATTER_WRITE')
  leaseTerms(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertLeaseTermsDto,
  ) {
    return this.matters.upsertLeaseTerms(user, id, dto);
  }

  @Post(':id/mediation-terms')
  @RequirePermissions('MATTER_WRITE')
  mediationTerms(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertMediationTermsDto,
  ) {
    return this.matters.upsertMediationTerms(user, id, dto);
  }

  @Post(':id/transition')
  @RequirePermissions('MATTER_TRANSITION')
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TransitionMatterDto,
  ) {
    return this.matters.transition(user, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('MATTER_TRANSITION')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelMatterDto,
  ) {
    return this.matters.cancel(user, id, dto.reason);
  }

  @Post(':id/renewals')
  @RequirePermissions('RENEWAL_MANAGE')
  createRenewal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateRenewalDto,
  ) {
    return this.matters.createRenewal(user, id, dto);
  }

  @Post(':id/checklist/:itemId/waive')
  @RequirePermissions('CHECKLIST_WAIVE')
  waiveChecklistItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: WaiveChecklistItemDto,
  ) {
    return this.matters.waiveChecklistItem(user, id, itemId, dto);
  }

  @Post(':id/checklist/:itemId/manual-status')
  @RequirePermissions('MATTER_WRITE')
  setManualChecklistStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: SetManualChecklistStatusDto,
  ) {
    return this.matters.setManualChecklistStatus(user, id, itemId, dto.status);
  }
}
