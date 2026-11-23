import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AuthErrors } from './auth-errors.filter.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';
import { authError } from './auth.service.js';
import type { AuthRequest } from './auth.http.js';

const uuid = new ParseUUIDPipe({
  exceptionFactory: () => authError('INVALID_INPUT'),
});
// AdminGuard only passes requests that carry authUser.
const adminId = (req: AuthRequest) => req.authUser!.id;

@Controller('admin')
@UseGuards(AdminGuard)
@UseFilters(AuthErrors)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('invites')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  createInvite(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.admin.createInvite(adminId(req), body);
  }

  @Get('invites')
  @Header('Cache-Control', 'no-store')
  async listInvites() {
    return { invites: await this.admin.listInvites() };
  }

  @Post('invites/:id/revoke')
  @HttpCode(204)
  revokeInvite(@Req() req: AuthRequest, @Param('id', uuid) id: string) {
    return this.admin.revokeInvite(adminId(req), id);
  }

  @Get('users')
  @Header('Cache-Control', 'no-store')
  findUser(@Req() req: AuthRequest, @Query('email') email: unknown) {
    return this.admin.findUser(adminId(req), email);
  }

  @Post('users/:id/reset-code')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async issueReset(
    @Req() req: AuthRequest,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    const { code, expiresAt } = await this.admin.issueReset(
      adminId(req),
      id,
      body,
    );
    return { code, expiresAt };
  }
}
