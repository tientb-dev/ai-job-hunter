import { Module } from '@nestjs/common';
import { adminEmails } from '../config/environment.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';
import { AuthController } from './auth.controller.js';
import { ADMIN_EMAILS, AUTH_SECURE_COOKIES } from './auth.tokens.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [AuthController, AdminController],
  providers: [
    AuthService,
    AdminService,
    AdminGuard,
    { provide: ADMIN_EMAILS, useFactory: () => adminEmails() },
    // Secure (__Host-) cookies need HTTPS; local development is plain http://127.0.0.1.
    {
      provide: AUTH_SECURE_COOKIES,
      useFactory: () => process.env.NODE_ENV === 'production',
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
