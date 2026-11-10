import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RequirePermissions } from '../auth/permissions.decorator';
import { DirectoryService } from './directory.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePersonDto, UpdatePropertyDto } from './dto/update-directory.dto';

@Controller()
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get('people')
  @RequirePermissions('DIRECTORY_READ')
  listPeople(@CurrentUser() user: AuthenticatedUser) {
    return this.directory.listPeople(user);
  }

  @Post('people')
  @RequirePermissions('DIRECTORY_WRITE')
  createPerson(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePersonDto) {
    return this.directory.createPerson(user, dto);
  }

  @Get('properties')
  @RequirePermissions('DIRECTORY_READ')
  listProperties(@CurrentUser() user: AuthenticatedUser) {
    return this.directory.listProperties(user);
  }

  @Post('properties')
  @RequirePermissions('DIRECTORY_WRITE')
  createProperty(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePropertyDto) {
    return this.directory.createProperty(user, dto);
  }

  @Patch('people/:id')
  @RequirePermissions('DIRECTORY_WRITE')
  updatePerson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePersonDto,
  ) {
    return this.directory.updatePerson(user, id, dto);
  }

  @Patch('properties/:id')
  @RequirePermissions('DIRECTORY_WRITE')
  updateProperty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.directory.updateProperty(user, id, dto);
  }
}
