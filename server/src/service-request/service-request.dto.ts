import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnswerInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') questionId!: string;
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
  })
  @IsDefined()
  value!: unknown;
}
export class ContactInputDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @ApiPropertyOptional({ format: 'email' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;
}
export class LocationInputDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  enteredAddress!: string;
  @ApiPropertyOptional({
    enum: [
      'entered_address',
      'intersection',
      'facility',
      'park',
      'parcel',
      'gis_asset',
      'other',
    ],
  })
  @IsOptional()
  @IsEnum([
    'entered_address',
    'intersection',
    'facility',
    'park',
    'parcel',
    'gis_asset',
    'other',
  ])
  locationType?: string;
}
export class CreateServiceRequestDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') serviceDefinitionId!: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  serviceDefinitionVersionId!: string;
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  description!: string;
  @ApiProperty({ enum: ['anonymous', 'identified'] })
  @IsEnum(['anonymous', 'identified'])
  reportingIdentity!: string;
  @ApiProperty({ type: [AnswerInputDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AnswerInputDto)
  answers!: AnswerInputDto[];
  @ApiPropertyOptional({ type: ContactInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactInputDto)
  contact?: ContactInputDto;
  @ApiPropertyOptional({ type: LocationInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationInputDto)
  location?: LocationInputDto;
}
export class CreateServiceRequestResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'SR-202609-000001' }) referenceNumber!: string;
  @ApiProperty({ enum: ['open'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class ServiceRequestDetailsResponseDto {
  @ApiProperty({ type: Object }) serviceRequest!: {
    id: string;
    referenceNumber: string;
    status: string;
    priority: string;
    createdAt: Date | string;
    updatedAt: Date | string;
    revision: number;
  };
  @ApiProperty({ type: Object }) classification!: {
    serviceDefinitionId: string;
    serviceDefinitionVersionId: string;
    issueName: string;
    category: { id: string; name: string };
    department: { id: string; name: string };
    division?: { id: string; name: string };
  };
  @ApiProperty({ type: Object }) request!: { description: string };
  @ApiProperty({ type: [Object] }) answers!: {
    questionId: string;
    questionKey: string;
    label: string;
    type: string;
    order: number;
    displayValue: string;
    value: string | number | boolean;
  }[];
  @ApiPropertyOptional({ type: Object }) location?: Record<string, unknown>;
  @ApiProperty({ type: Object }) requester!: {
    anonymous: boolean;
    name?: string;
    email?: string;
  };
  @ApiProperty({ type: [Object] }) activity!: {
    type: string;
    actorType: string;
    occurredAt: Date | string;
    metadata: Record<string, unknown>;
  }[];
}

export const serviceRequestListSorts = [
  'newest',
  'oldest',
  'reference_asc',
  'reference_desc',
  'priority',
  'status',
  'issue_name',
] as const;

export class ListServiceRequestsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
  @ApiPropertyOptional({ enum: ['open', 'closed', 'cancelled'] })
  @IsOptional()
  @IsIn(['open', 'closed', 'cancelled'])
  status?: string;
  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'urgent'] })
  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  department?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  division?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  category?: string;
  @ApiPropertyOptional({ enum: serviceRequestListSorts, default: 'newest' })
  @IsOptional()
  @IsIn(serviceRequestListSorts)
  sort?: (typeof serviceRequestListSorts)[number];
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ServiceRequestListRowDto {
  @ApiProperty({ format: 'uuid' }) serviceRequestId!: string;
  @ApiProperty({ example: 'SR-202609-000123' }) referenceNumber!: string;
  @ApiProperty() issueName!: string;
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
  @ApiProperty() categoryName!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty() departmentName!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) divisionId!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) divisionName!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() priority!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date | string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date | string;
  @ApiProperty() revision!: number;
}

export class ServiceRequestListResponseDto {
  @ApiProperty({ type: [ServiceRequestListRowDto] })
  items!: ServiceRequestListRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() hasPreviousPage!: boolean;
  @ApiProperty() hasNextPage!: boolean;
}
