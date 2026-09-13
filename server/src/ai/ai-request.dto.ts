import { BadRequestException } from '@nestjs/common';
import { Type, plainToInstance } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
  validateSync,
} from 'class-validator';
import type { AiGenerationRequest } from './ai.types.js';
export class AiSelectionDto {
  @Equals('explicit') kind!: 'explicit';
  @IsString() @Matches(/^[a-z0-9][a-z0-9._-]{0,63}$/) modelId!: string;
}
export class AiMessageDto {
  @IsIn(['employee', 'assistant']) author!: 'employee' | 'assistant';
  @IsString() @MinLength(1) @MaxLength(16000) @Matches(/\S/) text!: string;
}
export class AiGenerationDto implements AiGenerationRequest {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AiSelectionDto)
  selection!: AiSelectionDto;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => AiMessageDto)
  messages!: AiMessageDto[];
}
/** Reused by the internal router; no public generation endpoint is registered. */
export function validateAiRequest(input: unknown): AiGenerationRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException();
  const dto = plainToInstance(AiGenerationDto, input);
  if (
    validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }).length
  )
    throw new BadRequestException();
  return {
    selection: { kind: 'explicit', modelId: dto.selection.modelId },
    messages: dto.messages.map(({ author, text }) => ({ author, text })),
  };
}
