import Joi from 'joi';
import { databaseConnectionOptions } from './database-tls.js';

export type NodeEnvironment = 'development' | 'test' | 'production';
export type DatabaseSslMode = 'disable' | 'require' | 'verify-full';

export interface EnvironmentVariables {
  PARTICIPATION_SUPPRESSION_THRESHOLD: number;
  CITYVUE_DEPLOYMENT_PROFILE: 'development' | 'client';
  CITYVUE_ENABLE_EXTERNAL_IDENTITY: boolean;
  ENABLE_DEVELOPMENT_ATTACHMENTS: boolean;
  AI_TEST_EXECUTION_ENABLED: boolean;
  AI_ENABLED: boolean;
  AI_CHAT_ENABLED: false;
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DATABASE_URL: string;
  DATABASE_SSL_MODE: DatabaseSslMode;
  DATABASE_SSL_CA_FILE?: string;
  DATABASE_POOL_MAX: number;
  DATABASE_CONNECTION_TIMEOUT_MS: number;
  DATABASE_STATEMENT_TIMEOUT_MS: number;
  LOG_LEVEL: string;
  APP_NAME: string;
  APP_VERSION: string;
  CORS_ORIGINS: string;
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
  OTEL_SERVICE_NAME: string;
  DEVELOPMENT_ORGANIZATION_ID: string;
  ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS: boolean;
  ENABLE_DEVELOPMENT_STAFF_ACTIONS: boolean;
  DEVELOPMENT_STAFF_ACTOR_ID: string;
  LOCATION_ELIGIBILITY_PROVIDER: 'disabled' | 'development';
  ENABLE_DEVELOPMENT_LOCATION_ELIGIBILITY: boolean;
  LOCATION_ELIGIBILITY_TIMEOUT_MS: number;
  ENTRA_TENANT_ID?: string;
  ENTRA_API_CLIENT_ID?: string;
  ENTRA_EXPECTED_AUDIENCE?: string;
  ENTRA_REQUIRED_SCOPE: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

const environmentSchema = Joi.object<EnvironmentVariables>({
  PARTICIPATION_SUPPRESSION_THRESHOLD: Joi.number()
    .integer()
    .min(5)
    .max(1000)
    .default(5),
  CITYVUE_DEPLOYMENT_PROFILE: Joi.string()
    .valid('development', 'client')
    .default('development'),
  CITYVUE_ENABLE_EXTERNAL_IDENTITY: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  ENABLE_DEVELOPMENT_ATTACHMENTS: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  AI_TEST_EXECUTION_ENABLED: Joi.boolean().default(false),
  AI_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  AI_CHAT_ENABLED: Joi.boolean().valid(false).default(false),
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  DATABASE_SSL_MODE: Joi.string()
    .valid('disable', 'require', 'verify-full')
    .default('disable'),
  DATABASE_SSL_CA_FILE: Joi.string().trim().min(1).optional(),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(60000)
    .default(5000),
  DATABASE_STATEMENT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(300000)
    .default(30000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  APP_NAME: Joi.string().trim().min(1).max(100).default('cityvue-api'),
  APP_VERSION: Joi.string().trim().min(1).max(50).default('0.1.0'),
  CORS_ORIGINS: Joi.string()
    .default('http://localhost:5173')
    .custom((value: string, helpers) => {
      const origins = value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

      if (origins.length === 0 || origins.includes('*')) {
        return helpers.error('any.invalid');
      }

      try {
        origins.forEach((origin) => new URL(origin));
      } catch {
        return helpers.error('any.invalid');
      }

      return origins.join(',');
    }),
  RATE_LIMIT_TTL_MS: Joi.number().integer().min(1000).default(60000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(120),
  OTEL_SERVICE_NAME: Joi.string().trim().min(1).default('cityvue-api'),
  DEVELOPMENT_ORGANIZATION_ID: Joi.string()
    .guid({ version: ['uuidv4'] })
    .default('10000000-0000-4000-8000-000000000001'),
  ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  ENABLE_DEVELOPMENT_STAFF_ACTIONS: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  DEVELOPMENT_STAFF_ACTOR_ID: Joi.string()
    .guid({ version: ['uuidv4'] })
    .default('90000000-0000-4000-8000-000000000001'),
  LOCATION_ELIGIBILITY_PROVIDER: Joi.string()
    .valid('disabled', 'development')
    .default('disabled'),
  ENABLE_DEVELOPMENT_LOCATION_ELIGIBILITY: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  LOCATION_ELIGIBILITY_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(30000)
    .default(3000),
  ENTRA_TENANT_ID: Joi.string()
    .guid({ version: ['uuidv4'] })
    .optional(),
  ENTRA_API_CLIENT_ID: Joi.string()
    .guid({ version: ['uuidv4'] })
    .optional(),
  ENTRA_EXPECTED_AUDIENCE: Joi.string().trim().min(1).optional(),
  ENTRA_REQUIRED_SCOPE: Joi.string().trim().default('access_as_user'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().optional(),
}).unknown(true);

export function validateEnvironment(
  input: Record<string, unknown>,
): EnvironmentVariables {
  const { error, value } = environmentSchema.validate(input, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    if (error.details.some((detail) => detail.path[0] === 'DATABASE_URL')) {
      throw new Error(
        'Invalid server configuration: DATABASE_URL is required and must be a valid PostgreSQL URL',
      );
    }
    throw new Error(`Invalid server configuration: ${error.message}`);
  }

  const environment = value as EnvironmentVariables;
  if (
    environment.ENABLE_DEVELOPMENT_ATTACHMENTS &&
    (environment.NODE_ENV === 'production' ||
      environment.CITYVUE_DEPLOYMENT_PROFILE !== 'development')
  )
    throw new Error(
      'Invalid server configuration: development attachments cannot run in production or client profiles',
    );
  if (
    environment.NODE_ENV === 'development' &&
    environment.CITYVUE_DEPLOYMENT_PROFILE === 'development' &&
    environment.ENTRA_TENANT_ID &&
    !environment.CITYVUE_ENABLE_EXTERNAL_IDENTITY
  ) {
    throw new Error(
      'Invalid server configuration: development Entra identity requires explicit external identity opt-in',
    );
  }
  if (
    environment.CITYVUE_DEPLOYMENT_PROFILE === 'client' &&
    environment.CITYVUE_ENABLE_EXTERNAL_IDENTITY
  ) {
    throw new Error(
      'Invalid server configuration: development external identity opt-in is not valid in a client profile',
    );
  }
  if (
    environment.CITYVUE_ENABLE_EXTERNAL_IDENTITY &&
    !environment.ENTRA_TENANT_ID
  ) {
    throw new Error(
      'Invalid server configuration: external identity opt-in requires complete Entra configuration',
    );
  }
  if (
    environment.AI_TEST_EXECUTION_ENABLED &&
    (environment.NODE_ENV === 'production' || !environment.AI_ENABLED)
  )
    throw new Error(
      'Invalid server configuration: AI test execution requires non-production AI mode',
    );
  if (environment.AI_ENABLED && !environment.ENTRA_TENANT_ID) {
    throw new Error(
      'Invalid server configuration: AI_ENABLED requires Entra configuration',
    );
  }
  const entraValues = [
    environment.ENTRA_TENANT_ID,
    environment.ENTRA_API_CLIENT_ID,
    environment.ENTRA_EXPECTED_AUDIENCE,
  ];
  if (entraValues.some(Boolean) && !entraValues.every(Boolean)) {
    throw new Error(
      'Invalid server configuration: all Entra settings must be provided together',
    );
  }
  databaseConnectionOptions({
    environment: environment.NODE_ENV,
    url: environment.DATABASE_URL,
    sslMode: environment.DATABASE_SSL_MODE,
    caFile: environment.DATABASE_SSL_CA_FILE,
  });
  if (
    environment.NODE_ENV === 'production' &&
    environment.ENABLE_DEVELOPMENT_STAFF_ACTIONS
  ) {
    throw new Error(
      'Invalid server configuration: development staff actions cannot be enabled in production',
    );
  }
  if (
    environment.CITYVUE_DEPLOYMENT_PROFILE === 'client' &&
    (environment.ENABLE_DEVELOPMENT_STAFF_ACTIONS ||
      environment.ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS ||
      environment.ENABLE_DEVELOPMENT_LOCATION_ELIGIBILITY ||
      environment.LOCATION_ELIGIBILITY_PROVIDER === 'development')
  ) {
    throw new Error(
      'Invalid server configuration: development providers and access gates cannot be enabled in a client profile',
    );
  }
  if (
    environment.NODE_ENV === 'production' &&
    (environment.LOCATION_ELIGIBILITY_PROVIDER === 'development' ||
      environment.ENABLE_DEVELOPMENT_LOCATION_ELIGIBILITY)
  ) {
    throw new Error(
      'Invalid server configuration: development location eligibility cannot be enabled in production',
    );
  }
  if (
    environment.NODE_ENV === 'production' &&
    environment.ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS
  ) {
    throw new Error(
      'Invalid server configuration: development service request reads cannot be enabled in production',
    );
  }
  if (
    environment.NODE_ENV === 'production' &&
    environment.CITYVUE_DEPLOYMENT_PROFILE !== 'client'
  ) {
    throw new Error(
      'Invalid server configuration: production requires an explicit client deployment profile',
    );
  }

  return environment;
}

export function parseCorsOrigins(value: string): string[] {
  return value.split(',').map((origin) => origin.trim());
}
