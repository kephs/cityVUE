import { ApiProperty } from '@nestjs/swagger';

export class AiStatusDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: [false] }) chatEnabled!: false;
  @ApiProperty({ enum: ['unavailable'] }) availability!: 'unavailable';
}

export class AiModelDto {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() providerId!: string;
  @ApiProperty() description!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: ['unavailable', 'available'] }) availability!:
    'unavailable' | 'available';
  @ApiProperty({
    enum: ['text-generation', 'document-analysis', 'code-assistance'],
    isArray: true,
  })
  capabilities!: (
    'text-generation' | 'document-analysis' | 'code-assistance'
  )[];
  @ApiProperty({ type: String, nullable: true }) classificationPolicyId!:
    string | null;
}
