import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import {
  DevelopmentLocationEligibilityProvider,
  DisabledLocationEligibilityProvider,
} from './development-location-eligibility.provider.js';
import { LOCATION_ELIGIBILITY_PROVIDER } from './location-eligibility.types.js';
import { EvaluateLocationEligibilityService } from './evaluate-location-eligibility.service.js';

@Module({
  providers: [
    EvaluateLocationEligibilityService,
    {
      provide: LOCATION_ELIGIBILITY_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfiguration, true>) =>
        config.get('locationEligibility.developmentEnabled', { infer: true }) &&
        config.get('locationEligibility.provider', { infer: true }) ===
          'development'
          ? new DevelopmentLocationEligibilityProvider()
          : new DisabledLocationEligibilityProvider(),
    },
  ],
  exports: [LOCATION_ELIGIBILITY_PROVIDER, EvaluateLocationEligibilityService],
})
export class LocationEligibilityModule {}
