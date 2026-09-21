import { BadRequestException } from '@nestjs/common';

/** Matches existing narrative/textarea length semantics: UTF-16 code units. */
export const NOTE_BODY_MAXIMUM = 4000;

/** Plain text only; never include submitted content in an error. */
export function normalizeNoteBody(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > NOTE_BODY_MAXIMUM ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        (code < 32 && code !== 10 && code !== 13) ||
        (code >= 127 && code <= 159) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069) ||
        (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
      );
    })
  )
    throw new BadRequestException('Invalid internal note');
  const body = value.replace(/\r\n?/g, '\n').trim();
  if (!body) throw new BadRequestException('Internal note is required');
  return body;
}
