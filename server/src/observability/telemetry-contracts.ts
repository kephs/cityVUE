/** F061.1 definitions only: no SDK, transport, persistence or instrumentation. */
export const signalResponsibilities = Object.freeze({
  operational_log: Object.freeze({ owner: 'pino', authoritativeAudit: false }),
  trace: Object.freeze({
    owner: 'future_opentelemetry',
    authoritativeAudit: false,
  }),
  metric: Object.freeze({
    owner: 'future_opentelemetry',
    authoritativeAudit: false,
  }),
  authoritative_audit: Object.freeze({
    owner: 'reqro_audit_storage',
    authoritativeAudit: true,
  }),
} as const);

export type TelemetrySignal = 'operational_log' | 'trace' | 'metric';
export type EvidenceKind = TelemetrySignal | 'authoritative_audit';
export interface TelemetryEvidence {
  readonly kind: TelemetrySignal;
  readonly satisfiesAuthoritativeAudit: false;
}
export interface AuthoritativeAuditRequirement {
  readonly kind: 'authoritative_audit';
  readonly storage: 'reqro_audit_storage';
  readonly telemetrySubstitution: 'forbidden';
}

/** Descriptive references only, NOT identity validators or wire-header parsers. */
export interface CorrelationReferences {
  readonly reqroCorrelationId: string;
  readonly w3cTraceId?: string;
  readonly w3cSpanId?: string;
}
export const correlationPolicy = Object.freeze({
  reqroCorrelationId: 'existing_server_generated_uuid',
  traceIdReplacesCorrelationId: false,
  spanIdReplacesCorrelationId: false,
  inboundContextAuthority: 'none',
  tenantAuthorityFromTrace: false,
  authenticationAuthorityFromTrace: false,
  auditIdentityFromTrace: false,
  metricLabels: 'forbidden',
  outboundPropagation: 'future_approved_contract_only',
} as const);

/** Conservative starter set, not automatic discovery of every application route.
 * Additions require review. Release is a finite cohort, never a raw SHA/tag. */
export const metricDimensions = Object.freeze({
  environment: Object.freeze(['development', 'test', 'production'] as const),
  service: Object.freeze(['cityvue-api'] as const),
  component: Object.freeze([
    'http',
    'database',
    'tenancy',
    'operator',
    'integration',
  ] as const),
  routeTemplate: Object.freeze([
    '/api/v1/service-requests',
    '/api/v1/service-requests/:serviceRequestId',
    '/api/v1/health/live',
    '/api/v1/health/ready',
    'unmatched',
  ] as const),
  method: Object.freeze([
    'GET',
    'HEAD',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
    'other',
  ] as const),
  statusClass: Object.freeze([
    '1xx',
    '2xx',
    '3xx',
    '4xx',
    '5xx',
    'no_response',
  ] as const),
  operation: Object.freeze([
    'read',
    'create',
    'update',
    'delete',
    'resolve',
    'execute',
    'deliver',
    'reconcile',
  ] as const),
  outcome: Object.freeze([
    'succeeded',
    'failed',
    'refused',
    'unavailable',
    'pending',
  ] as const),
  reason: Object.freeze([
    'none',
    'unknown',
    'timeout',
    'dependency_unavailable',
    'invalid_authority',
    'unknown_host',
    'untrusted_forwarded_peer',
    'registry_unavailable',
  ] as const),
  endpointClass: Object.freeze([
    'resident',
    'staff',
    'health',
    'operator',
    'integration',
    'unmatched',
  ] as const),
  dependencyClass: Object.freeze([
    'database',
    'identity',
    'registry',
    'integration',
    'audit',
  ] as const),
  releaseCohort: Object.freeze(['current', 'previous', 'unknown'] as const),
  healthSignal: Object.freeze([
    'liveness',
    'database_readiness',
    'hostname_readiness',
    'worker_liveness',
    'worker_readiness',
    'worker_draining',
    'worker_progress',
  ] as const),
});
export type MetricDimension = keyof typeof metricDimensions;
export type MetricLabels = {
  readonly [K in MetricDimension]?: (typeof metricDimensions)[K][number];
};

export const forbiddenAttributes = Object.freeze([
  'residentName',
  'email',
  'phone',
  'address',
  'requestBody',
  'authorization',
  'authorizationHeader',
  'token',
  'cookie',
  'trackingCredential',
  'attachmentClaims',
  'rawQuery',
  'rawQueryString',
  'rawUrl',
  'url',
  'path',
  'error',
  'errorMessage',
  'rawHost',
  'host',
  'forwardedHost',
  'databaseConnectionString',
  'databaseUrl',
  'secret',
  'apiKey',
  'microsoftGraphPayload',
  'externalSystemPayload',
] as const);
export const metricOnlyForbiddenAttributes = Object.freeze([
  'serviceRequestId',
  'residentId',
  'correlationId',
  'reqroCorrelationId',
  'traceId',
  'w3cTraceId',
  'spanId',
  'w3cSpanId',
  'externalRecordId',
  'jobId',
  'runId',
] as const);
export const restrictedAttributes = Object.freeze([
  'organizationId',
  'customerHostname',
  'tenantHostname',
  'connectorId',
  'operatorIdentity',
  'entraObjectId',
] as const);
export const restrictedAttributePolicy = Object.freeze({
  metricLabels: 'forbidden',
  logsAndTraces: 'explicit_privacy_and_operations_review_required',
} as const);

/** Names are concepts, not instruments. No instances, values or emission API. */
export const metricConcepts = Object.freeze({
  request_count: 'count',
  request_duration: 'milliseconds',
  error_count: 'count',
  readiness_result: 'outcome',
  dependency_latency: 'milliseconds',
  dependency_failure: 'count',
  tenant_resolution_outcome: 'outcome',
  operator_execution_outcome: 'outcome',
  integration_delivery_latency: 'milliseconds',
  integration_retry_count: 'count',
  integration_dead_letter_count: 'count',
  integration_reconciliation_failure: 'count',
  integration_connector_health: 'outcome',
  // Backlog observations, not cumulative events; ready is a subset of pending.
  integration_pending_count: 'count',
  integration_ready_count: 'count',
  // Age of the oldest eligible pending obligation, not its expiry threshold.
  // Eligibility/original pending timestamp are owned by the delivery policy.
  integration_oldest_pending_age: 'milliseconds',
  // Successful claim events; claim rate is derived over a future approved window.
  integration_claim_count: 'count',
  // Currently unresolved ambiguous obligations, not ambiguous attempt events.
  integration_ambiguous_count: 'count',
} as const);
export type MetricConcept = keyof typeof metricConcepts;

/** F061.3A health observation contracts only, not new metric dimensions.
 * No observation is collected, evaluated or used to control a worker here.
 */
export const workerHealthStates = Object.freeze({
  worker_liveness: Object.freeze(['alive', 'not_alive', 'unknown'] as const),
  worker_readiness: Object.freeze(['ready', 'not_ready', 'unknown'] as const),
  worker_draining: Object.freeze([
    'draining',
    'not_draining',
    'unknown',
  ] as const),
  worker_progress: Object.freeze([
    'progressing',
    'idle',
    'stalled',
    'unknown',
  ] as const),
});
export type WorkerHealthSignal = keyof typeof workerHealthStates;
export type WorkerHealthObservation = {
  [K in WorkerHealthSignal]: {
    readonly signal: K;
    readonly state: (typeof workerHealthStates)[K][number];
  };
}[WorkerHealthSignal];

/** Declarative separation requirements, never a health evaluator or restart rule. */
export const workerHealthSeparation = Object.freeze({
  workerHealthIsConnectorHealth: false,
  workerHealthDeterminesApiReadiness: false,
  connectorHealthDeterminesApiReadiness: false,
  destinationOutageFailsWorkerLiveness: false,
  stalledBacklogFailsWorkerLiveness: false,
  stalledBacklogRequiresRestart: false,
  drainingAllowsNewClaims: false,
  drainingAllowsBoundedInflightCompletion: true,
} as const);

/** Design metadata, not telemetry attributes or a calculation engine.
 * No target percentages are assigned; approval references are not proof of authority. */
export interface SliDefinition {
  readonly identifier: string;
  readonly description: string;
  readonly numerator: {
    readonly concept: MetricConcept;
    readonly population: string;
  };
  readonly denominator: {
    readonly concept: MetricConcept;
    readonly population: string;
  };
  readonly window: 'request' | 'rolling' | 'calendar' | 'delivery_deadline';
  readonly scope: 'tenant_deployment' | 'platform';
  readonly maintenance: 'included' | 'approved_adjusted_with_inclusive_report';
  readonly dependencyHandling: 'include_eligible_dependency_failures';
  readonly owner:
    | { readonly status: 'unassigned' }
    | { readonly status: 'assigned'; readonly reference: string };
  readonly target:
    | { readonly status: 'provisional' }
    | { readonly status: 'approved'; readonly approvalReference: string };
}
