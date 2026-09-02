import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { DatabaseService } from '../database/database.service.js';

export interface LivenessResponse {
  status: 'ok';
  service: string;
  version: string;
}

export interface ReadinessResponse extends LivenessResponse {
  database: 'up';
}

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}

  live(): LivenessResponse {
    return {
      status: 'ok',
      service: this.config.get('app.name', { infer: true }),
      version: this.config.get('app.version', { infer: true }),
    };
  }

  async ready(): Promise<ReadinessResponse | null> {
    const database = await this.database.status();
    return database === 'up' ? { ...this.live(), database } : null;
  }
}
