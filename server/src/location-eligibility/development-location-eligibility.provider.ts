import type {
  LocationEligibilityProvider,
  LocationEligibilityRequest,
  LocationEligibilityResponse,
} from './location-eligibility.types.js';

export class DevelopmentLocationEligibilityProvider implements LocationEligibilityProvider {
  evaluate(
    request: LocationEligibilityRequest,
  ): Promise<LocationEligibilityResponse> {
    const key = request.enteredAddress.trim().toUpperCase();
    const result =
      key === 'DEV-ELIGIBLE'
        ? 'eligible'
        : key === 'DEV-INELIGIBLE'
          ? 'ineligible'
          : 'unable_to_determine';
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
