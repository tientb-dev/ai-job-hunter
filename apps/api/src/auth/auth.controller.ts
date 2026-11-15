import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { AuthService, authError } from './auth.service.js';
import { sessionCookie } from './auth.http.js';
import type { AuthRequest } from './auth.http.js';
import { AUTH_SECURE_COOKIES } from './auth.tokens.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(AUTH_SECURE_COOKIES) private readonly secure: boolean,
  ) {}

  private me(req: AuthRequest) {
    const user = req.authUser;
    if (!user) throw authError('UNAUTHENTICATED');
    return { email: user.email };
  }

  @Post('register')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    res.setHeader(
      'Set-Cookie',
      sessionCookie(await this.auth.register(body), this.secure),
    );
    return { ok: true };
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    res.setHeader(
      'Set-Cookie',
      sessionCookie(await this.auth.login(body), this.secure),
    );
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    if (req.sessionToken) await this.auth.logout(req.sessionToken);
    res.setHeader('Set-Cookie', sessionCookie(null, this.secure));
  }

  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() body: unknown) {
    await this.auth.resetPassword(body);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  current(@Req() req: AuthRequest) {
    return this.me(req);
  }
}
