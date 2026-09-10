import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AlertInputDto } from './alert.dto.js';

export function validateAlertInput(input: unknown): AlertInputDto {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Invalid alert');
  const dto = plainToInstance(AlertInputDto, input);
  if (
    validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length ||
    (dto.expiresAt && Date.parse(dto.expiresAt) <= Date.parse(dto.startsAt)) ||
    (dto.linkLabel && !dto.linkUrl)
  )
    throw new BadRequestException('Invalid alert');
  return dto;
}

export function isAlertVisible(
  alert: {
    is_active: boolean;
    starts_at: Date;
    expires_at: Date | null;
    published_at: Date | null;
    deactivated_at: Date | null;
  },
  now: Date,
): boolean {
  return (
    alert.is_active &&
    alert.published_at !== null &&
    alert.published_at <= now &&
    alert.deactivated_at === null &&
    alert.starts_at <= now &&
    (alert.expires_at === null || alert.expires_at > now)
  );
}
