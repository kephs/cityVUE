import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { PinoLoggerService } from '../common/logging/pino-logger.service.js';
import {
  LOCATION_ELIGIBILITY_PROVIDER,
  type LocationEligibilityProvider,
  type LocationEligibilityResponse,
} from './location-eligibility.types.js';

@Injectable()
export class EvaluateLocationEligibilityService {
  private readonly timeoutMs: number;
  constructor(
    config: ConfigService<AppConfiguration, true>,
    @Inject(LOCATION_ELIGIBILITY_PROVIDER)
    private readonly provider: LocationEligibilityProvider,
    private readonly logger: PinoLoggerService,
  ) {
    this.timeoutMs = config.get('locationEligibility.timeoutMs', {
      infer: true,
    });
  }
  async execute(input: {
    organizationId: string;
    policyType: string;
    policyReference: string | null;
    unableToDetermineBehavior: string;
    enteredAddress: string;
    locationType: string;
  }): Promise<LocationEligibilityResponse | null> {
    if (input.policyType === 'no_geographic_restriction') return null;
    const started = Date.now();
    this.logger.logger.info(
      { policyType: input.policyType },
      'Location eligibility validation started',
    );
    let response: LocationEligibilityResponse;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      response = await Promise.race([
        this.provider.evaluate({
          organizationId: input.organizationId,
          policyType: input.policyType,
          policyReference: input.policyReference,
          enteredAddress: input.enteredAddress,
          normalizedAddress: null,
          latitude: null,
          longitude: null,
          locationType: input.locationType,
          facilityReference: null,
          parkReference: null,
          parcelReference: null,
          assetReference: null,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error('provider_timeout'));
          }, this.timeoutMs);
        }),
      ]);
    } catch {
      response = {
        result: 'unable_to_determine',
        policyType: input.policyType,
        validatedAt: new Date(),
        providerKey: 'unavailable',
        providerReference: null,
        reasonCode: 'provider_unavailable',
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    this.logger.logger.info(
      {
        policyType: input.policyType,
        result: response.result,
        durationMs: Date.now() - started,
        reasonCode: response.reasonCode,
      },
      'Location eligibility validation completed',
    );
    if (response.result === 'ineligible')
      throw new BadRequestException({
        code: 'LOCATION_INELIGIBLE',
        message:
          'This issue appears to be outside the service area for this request type.',
      });
    if (response.result === 'unable_to_determine') {
      if (input.unableToDetermineBehavior !== 'block')
        throw new Error('Unsupported unable-to-determine behavior');
      const unavailable = response.reasonCode === 'provider_unavailable';
      throw new BadRequestException({
        code: unavailable
          ? 'LOCATION_ELIGIBILITY_UNAVAILABLE'
          : 'LOCATION_ELIGIBILITY_UNDETERMINED',
        message: unavailable
          ? 'Location validation is temporarily unavailable. Please try again.'
          : 'We could not confirm whether this location is eligible. Please check the location and try again.',
      });
    }
    return response;
  }
}
