import { Global, Module } from '@nestjs/common';
import { EntraTokenService } from './entra-token.service.js';
import { RequesterAccessGuard } from './requester-access.guard.js';
import { StaffAccessGuard } from './staff-access.guard.js';
import { StaffAuthorizationService } from './staff-authorization.service.js';
@Global()
@Module({
  providers: [
    EntraTokenService,
    StaffAuthorizationService,
    StaffAccessGuard,
    RequesterAccessGuard,
  ],
  exports: [
    EntraTokenService,
    StaffAuthorizationService,
    StaffAccessGuard,
    RequesterAccessGuard,
  ],
})
export class AuthModule {}
