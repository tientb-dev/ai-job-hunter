import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AUTH_SECURE_COOKIES } from './auth.tokens.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    // Secure (__Host-) cookies need HTTPS; local development is plain http://127.0.0.1.
    {
      provide: AUTH_SECURE_COOKIES,
      useFactory: () => process.env.NODE_ENV === 'production',
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
