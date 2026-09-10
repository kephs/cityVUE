import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { AlertsRepository } from './alerts.repository.js';
import { validateAlertInput } from './alert.domain.js';
import type { PublicAlertDto } from './alert.dto.js';

@Injectable()
export class AlertsService {
  private readonly organizationId: string;
  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly repository: AlertsRepository,
  ) {
    this.organizationId = config.get('catalog.developmentOrganizationId', {
      infer: true,
    });
  }
  async listActive(): Promise<PublicAlertDto[]> {
    const rows = await this.repository.listActive(
      this.organizationId,
      new Date(),
    );
    return rows.flatMap((row) => {
      // Fail closed for invalid stored content; never return raw rows or audit actors.
      try {
        const content = validateAlertInput({
          type: row.type,
          severity: row.severity,
          title: row.title,
          message: row.message,
          startsAt: row.starts_at.toISOString(),
          expiresAt: row.expires_at?.toISOString() ?? null,
          linkUrl: row.link_url,
          linkLabel: row.link_label,
        });
        if (!row.published_at) return [];
        return [
          {
            id: row.id,
            type: content.type,
            severity: content.severity,
            title: content.title,
            message: content.message,
            startsAt: content.startsAt,
            expiresAt: content.expiresAt ?? null,
            linkUrl: content.linkUrl ?? null,
            linkLabel: content.linkLabel ?? null,
            publishedAt: row.published_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
          },
        ];
      } catch {
        return [];
      }
    });
  }
}
