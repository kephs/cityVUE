import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
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
