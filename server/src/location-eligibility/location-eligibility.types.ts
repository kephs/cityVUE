export const eligibilityResults = [
  'eligible',
  'ineligible',
  'unable_to_determine',
] as const;
export type EligibilityResult = (typeof eligibilityResults)[number];

export interface LocationEligibilityRequest {
  organizationId: string;
  policyType: string;
  policyReference: string | null;
  enteredAddress: string;
  normalizedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  locationType: string;
  facilityReference: string | null;
  parkReference: string | null;
  parcelReference: string | null;
  assetReference: string | null;
}

export interface LocationEligibilityResponse {
  result: EligibilityResult;
  policyType: string;
  validatedAt: Date;
  providerKey: string;
  providerReference: string | null;
  reasonCode: string;
}

export interface LocationEligibilityProvider {
  evaluate(
    request: LocationEligibilityRequest,
  ): Promise<LocationEligibilityResponse>;
}

export const LOCATION_ELIGIBILITY_PROVIDER = Symbol(
  'LOCATION_ELIGIBILITY_PROVIDER',
);
