import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto, RequestPasswordRecoveryDto, ResetPasswordDto } from './dto/password.dto';
import { Public } from './public.decorator';
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from './session-token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto);
    response.cookie(SESSION_COOKIE_NAME, result.accessToken, this.cookieOptions());
    return result;
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return {
      id: user.userId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      organization: {
        id: user.organizationId,
        name: user.organizationName,
      },
    };
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions(false));
    return { ok: true };
  }

  @Public()
  @Post('password-recovery/request')
  requestPasswordRecovery(@Body() dto: RequestPasswordRecoveryDto) {
    return this.auth.requestPasswordRecovery(dto);
  }

  @Public()
  @Post('password-recovery/confirm')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.resetPassword(dto);
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions(false));
    return result;
  }

  @Post('change-password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.changePassword(user, dto);
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions(false));
    return result;
  }

  private cookieOptions(includeLifetime = true): CookieOptions {
    const options: CookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('COOKIE_SECURE', 'false') === 'true',
      path: '/',
    };
    if (includeLifetime) options.maxAge = SESSION_MAX_AGE_MS;
    return options;
  }
}
