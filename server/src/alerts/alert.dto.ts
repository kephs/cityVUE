import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const alertTypes = [
  'notice',
  'service_disruption',
  'utility',
  'closure',
  'emergency',
] as const;
export const alertSeverities = [
  'info',
  'advisory',
  'warning',
  'critical',
] as const;
export type AlertType = (typeof alertTypes)[number];
export type AlertSeverity = (typeof alertSeverities)[number];
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const optional = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

// Domain input only. No administrative HTTP controller is registered.
export class AlertInputDto {
  @IsIn(alertTypes) type!: AlertType;
  @IsIn(alertSeverities) severity!: AlertSeverity;
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(/^[^<>]*$/)
  title!: string;
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(/^[^<>]*$/)
  message!: string;
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  startsAt!: string;
  @Transform(optional)
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  expiresAt?: string | null;
  @Transform(optional)
  @IsOptional()
  @MaxLength(2048)
  @IsUrl({ protocols: ['https'], require_protocol: true, disallow_auth: true })
  imageUrl?: string | null;
  @Transform(optional)
  @IsOptional()
  @MaxLength(2048)
  @IsUrl({ protocols: ['https'], require_protocol: true, disallow_auth: true })
  linkUrl?: string | null;
  @Transform(optional)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^<>]*$/)
  linkLabel?: string | null;
}

export class PublicAlertDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: alertTypes }) type!: AlertType;
  @ApiProperty({ enum: alertSeverities }) severity!: AlertSeverity;
  @ApiProperty() title!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ type: String, nullable: true }) linkUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) linkLabel!: string | null;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  expiresAt!: string | null;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
