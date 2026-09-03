import Joi from 'joi';

export type NodeEnvironment = 'development' | 'test' | 'production';
export type DatabaseSslMode = 'disable' | 'require' | 'verify-full';

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DATABASE_URL: string;
  DATABASE_SSL_MODE: DatabaseSslMode;
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
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

const environmentSchema = Joi.object<EnvironmentVariables>({
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
    throw new Error(`Invalid server configuration: ${error.message}`);
  }

  const environment = value as EnvironmentVariables;
  if (
    environment.NODE_ENV === 'production' &&
    environment.DATABASE_SSL_MODE === 'disable'
  ) {
    throw new Error(
      'Invalid server configuration: DATABASE_SSL_MODE cannot be disable in production',
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

  return environment;
}

export function parseCorsOrigins(value: string): string[] {
  return value.split(',').map((origin) => origin.trim());
}
