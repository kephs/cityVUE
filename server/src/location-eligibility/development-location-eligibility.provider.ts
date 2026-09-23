import type {
  LocationEligibilityProvider,
  LocationEligibilityRequest,
  LocationEligibilityResponse,
} from './location-eligibility.types.js';
import { syntheticServiceBoundary } from '../geospatial/synthetic-geospatial.repository.js';
import {
  pointInServiceBoundary,
  validServicePoint,
} from './service-location.domain.js';

export class DevelopmentLocationEligibilityProvider implements LocationEligibilityProvider {
  evaluate(
    request: LocationEligibilityRequest,
  ): Promise<LocationEligibilityResponse> {
    const key = request.enteredAddress.trim().toUpperCase();
    let result: LocationEligibilityResponse['result'] =
      key === 'DEV-ELIGIBLE'
        ? 'eligible'
        : key === 'DEV-INELIGIBLE'
          ? 'ineligible'
          : 'unable_to_determine';
    if (request.latitude !== null || request.longitude !== null) {
      const boundary = syntheticServiceBoundary(request.organizationId);
      result =
        boundary &&
        validServicePoint(request.latitude, request.longitude) &&
        ['city_boundary', 'service_area'].includes(request.policyType)
          ? pointInServiceBoundary(
              request.latitude ?? NaN,
              request.longitude ?? NaN,
              boundary,
            )
            ? 'eligible'
            : 'ineligible'
          : 'unable_to_determine';
    }
    return Promise.resolve({
      result,
      policyType: request.policyType,
      validatedAt: new Date(),
      providerKey: 'development',
      providerReference: null,
      reasonCode:
        result === 'eligible'
          ? 'development_match'
          : result === 'ineligible'
            ? 'development_outside'
            : 'development_no_match',
    });
  }
}

export class DisabledLocationEligibilityProvider implements LocationEligibilityProvider {
  evaluate(
    request: LocationEligibilityRequest,
  ): Promise<LocationEligibilityResponse> {
    return Promise.resolve({
      result: 'unable_to_determine',
      policyType: request.policyType,
      validatedAt: new Date(),
      providerKey: 'disabled',
      providerReference: null,
      reasonCode: 'provider_unavailable',
    });
  }
}
