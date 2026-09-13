import { Global, Module } from '@nestjs/common';
import { EntraTokenService } from './entra-token.service.js';
import { StaffAccessGuard } from './staff-access.guard.js';
import { StaffAuthorizationService } from './staff-authorization.service.js';
@Global()
@Module({
  providers: [EntraTokenService, StaffAuthorizationService, StaffAccessGuard],
  exports: [EntraTokenService, StaffAuthorizationService, StaffAccessGuard],
})
export class AuthModule {}
