import { Injectable } from '@nestjs/common';
import { AlertsRepository } from './alerts.repository.js';
import { validateAlertInput } from './alert.domain.js';
import type { PublicAlertDto } from './alert.dto.js';

@Injectable()
export class AlertsService {
  constructor(private readonly repository: AlertsRepository) {}
  /** ADR-025. Organization is supplied by the caller from the resolved
   * resident TenantContext; this service holds no Organization of its own and
   * has no configuration fallback. */
  async listActive(organizationId: string): Promise<PublicAlertDto[]> {
    const rows = await this.repository.listActive(organizationId, new Date());
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
