export interface AppConfiguration {
  participation?: { suppressionThreshold: number };
  attachments?: { developmentEnabled: boolean };
  deployment: {
    profile: 'development' | 'client';
    externalIdentityEnabled: boolean;
  };
  ai: { enabled: boolean; chatEnabled: false; testExecutionEnabled: boolean };
  app: {
    name: string;
    version: string;
    environment: string;
    port: number;
    corsOrigins: string;
  };
  database: {
    url: string;
    sslMode: string;
    caFile?: string;
    poolMax: number;
    connectionTimeoutMs: number;
    statementTimeoutMs: number;
  };
  logging: {
    level: string;
  };
  rateLimit: {
    ttlMs: number;
    max: number;
  };
  telemetry: {
    serviceName: string;
    otlpEndpoint?: string;
  };
  catalog: { developmentOrganizationId: string };
  serviceRequestReads: { developmentEnabled: boolean };
  staffActions: { developmentEnabled: boolean; developmentActorId: string };
  entra: {
    enabled: boolean;
    tenantId?: string;
    apiClientId?: string;
    expectedAudience?: string;
    requiredScope: string;
  };
  locationEligibility: {
    provider: string;
    developmentEnabled: boolean;
    timeoutMs: number;
  };
}

export function configuration(): AppConfiguration {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  return {
    participation: {
      suppressionThreshold: Number(
        process.env.PARTICIPATION_SUPPRESSION_THRESHOLD ?? 5,
      ),
    },
    attachments: {
      developmentEnabled: process.env.ENABLE_DEVELOPMENT_ATTACHMENTS === 'true',
    },
    deployment: {
      profile: (process.env.CITYVUE_DEPLOYMENT_PROFILE ?? 'development') as
        'development' | 'client',
      externalIdentityEnabled:
        process.env.CITYVUE_ENABLE_EXTERNAL_IDENTITY === 'true',
    },
    ai: {
      enabled: process.env.AI_ENABLED === 'true',
      chatEnabled: false,
      testExecutionEnabled: process.env.AI_TEST_EXECUTION_ENABLED === 'true',
    },
    app: {
      name: process.env.APP_NAME ?? 'cityvue-api',
      version: process.env.APP_VERSION ?? '0.1.0',
      environment: process.env.NODE_ENV ?? 'development',
      port: Number(process.env.PORT ?? 3000),
      corsOrigins: process.env.CORS_ORIGINS ?? 'http://localhost:5173',
    },
    database: {
      url: process.env.DATABASE_URL ?? '',
      sslMode: process.env.DATABASE_SSL_MODE ?? 'disable',
      ...(process.env.DATABASE_SSL_CA_FILE
        ? { caFile: process.env.DATABASE_SSL_CA_FILE }
        : {}),
      poolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),
      connectionTimeoutMs: Number(
        process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 5000,
      ),
      statementTimeoutMs: Number(
        process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 30000,
      ),
    },
    logging: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    rateLimit: {
      ttlMs: Number(process.env.RATE_LIMIT_TTL_MS ?? 60000),
      max: Number(process.env.RATE_LIMIT_MAX ?? 120),
    },
    telemetry: {
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'cityvue-api',
      ...(otlpEndpoint ? { otlpEndpoint } : {}),
    },
    catalog: {
      developmentOrganizationId:
        process.env.DEVELOPMENT_ORGANIZATION_ID ??
        '10000000-0000-4000-8000-000000000001',
    },
    serviceRequestReads: {
      developmentEnabled:
        process.env.ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS === 'true',
    },
    staffActions: {
      developmentEnabled:
        process.env.ENABLE_DEVELOPMENT_STAFF_ACTIONS === 'true',
      developmentActorId:
        process.env.DEVELOPMENT_STAFF_ACTOR_ID ??
        '90000000-0000-4000-8000-000000000001',
    },
    entra: {
      enabled: Boolean(process.env.ENTRA_TENANT_ID),
      ...(process.env.ENTRA_TENANT_ID
        ? { tenantId: process.env.ENTRA_TENANT_ID }
        : {}),
      ...(process.env.ENTRA_API_CLIENT_ID
        ? { apiClientId: process.env.ENTRA_API_CLIENT_ID }
        : {}),
      ...(process.env.ENTRA_EXPECTED_AUDIENCE
        ? { expectedAudience: process.env.ENTRA_EXPECTED_AUDIENCE }
        : {}),
      requiredScope: process.env.ENTRA_REQUIRED_SCOPE ?? 'access_as_user',
    },
    locationEligibility: {
      provider: process.env.LOCATION_ELIGIBILITY_PROVIDER ?? 'disabled',
      developmentEnabled:
        process.env.ENABLE_DEVELOPMENT_LOCATION_ELIGIBILITY === 'true',
      timeoutMs: Number(process.env.LOCATION_ELIGIBILITY_TIMEOUT_MS ?? 3000),
    },
  };
}
