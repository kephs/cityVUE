import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Permission, StaffAccess } from '../../src/auth/auth.types.js';
import { StaffAccessGuard } from '../../src/auth/staff-access.guard.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { AdminResidentReviewController } from '../../src/resident-experience/resident-experience.review.controller.js';
import { AdminResidentReviewService } from '../../src/resident-experience/resident-experience.review.service.js';

/** Synthetic verified principals only. Database tests supply the real review service. */
export async function residentReviewApi(
  service: Pick<
    AdminResidentReviewService,
    'context' | 'revision' | 'get' | 'create' | 'decide'
  >,
  accounts: Record<string, StaffAccess>,
) {
  const module = await Test.createTestingModule({
    controllers: [AdminResidentReviewController],
    providers: [
      StaffAccessGuard,
      Reflector,
      { provide: ConfigService, useValue: { get: () => false } },
      { provide: DatabaseService, useValue: {} },
      {
        provide: EntraTokenService,
        useValue: {
          enabled: true,
          hasRequiredScope: () => true,
          validate: async (token: string) => {
            if (!accounts[token]) throw new UnauthorizedException();
            return { objectId: token };
          },
        },
      },
      {
        provide: StaffAuthorizationService,
        useValue: {
          resolve: async ({ objectId }: { objectId: string }) =>
            accounts[objectId],
          assertPermission: (access: StaffAccess, permission: Permission) => {
            if (!access.permissions.includes(permission))
              throw new ForbiddenException();
          },
        },
      },
      { provide: AdminResidentReviewService, useValue: service },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}
