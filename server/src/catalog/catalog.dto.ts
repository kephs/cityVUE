import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() iconKey!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty() departmentName!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) divisionId!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) divisionName!: string | null;
}

export class IssueSummaryDto {
  @ApiProperty({ enum: ['internal_intake', 'external_redirect'] })
  actionType!: string;
  @ApiPropertyOptional({ type: Object }) redirect?: {
    destination: string;
    message: string;
    label: string;
  };
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() iconKey!: string;
}

export class VisibilityConditionDto {
  @ApiProperty() questionKey!: string;
  @ApiProperty({ enum: ['equals'] }) operator!: 'equals';
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
  })
  value!: string | number | boolean;
}

export class QuestionOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
}

export class QuestionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiPropertyOptional({ nullable: true }) helpText!: string | null;
  @ApiProperty({
    enum: [
      'short_text',
      'long_text',
      'number',
      'yes_no',
      'single_select',
      'multi_select',
      'date',
      'information',
    ],
  })
  type!: string;
  @ApiProperty() required!: boolean;
  @ApiPropertyOptional({ nullable: true, type: VisibilityConditionDto })
  visibilityCondition!: VisibilityConditionDto | null;
  @ApiProperty({ type: [QuestionOptionDto] }) options!: QuestionOptionDto[];
}

export class IssueDetailDto extends IssueSummaryDto {
  @ApiProperty() actionRevision!: number;
  @ApiProperty({ enum: ['IDENTIFIED_REQUIRED', 'ANONYMOUS_ALLOWED'] })
  requesterIdentityPolicy!: string;
  @ApiProperty({ format: 'uuid' }) serviceDefinitionVersionId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['low', 'medium', 'high', 'urgent'] })
  defaultPriority!: string;
  @ApiProperty({ enum: ['required', 'optional', 'not_applicable'] })
  locationPolicy!: string;
  @ApiProperty() geographicEligibilityMode!: string;
  @ApiProperty({ enum: ['allowed', 'not_allowed', 'allowed_with_limitations'] })
  anonymousReportingPolicy!: string;
  @ApiProperty({ type: [QuestionDto] }) questions!: QuestionDto[];
}
