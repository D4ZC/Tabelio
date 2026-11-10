import { Body, Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { McpService } from './mcp.service';

@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  post(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mcp.handle(request, response, body, user);
  }

  @Get()
  get(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mcp.handle(request, response, undefined, user);
  }

  @Delete()
  delete(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mcp.handle(request, response, undefined, user);
  }
}
