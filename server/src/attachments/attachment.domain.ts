import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const attachmentContexts = [
  'REQUEST_EVIDENCE',
  'INTERNAL_NOTE',
  'REQUESTER_COMMUNICATION',
] as const;
export type AttachmentContext = (typeof attachmentContexts)[number];
export const attachmentLimits = {
  fileBytes: 5 * 1024 * 1024,
  files: 5,
  totalBytes: 15 * 1024 * 1024,
  pixels: 16_000_000,
  dimension: 8192,
  lifetimeMs: 30 * 60 * 1000,
} as const;
const formats = {
  jpeg: { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'] },
  png: { mime: 'image/png', extensions: ['png'] },
  webp: { mime: 'image/webp', extensions: ['webp'] },
} as const;
export const checksum = (bytes: Buffer | string) =>
  createHash('sha256').update(bytes).digest('hex');

/** Display-only ASCII filename. Never a storage path; unsafe Unicode/control text is removed. */
export function safeFilename(value: string): string {
  return (
    value
      .normalize('NFKC')
      .replace(/%[0-9a-f]{2}/gi, '_')
      .replace(/[^a-zA-Z0-9._ -]/g, '_')
      .replace(/\.{2,}/g, '_')
      .replace(/^[ .]+|[ .]+$/g, '')
      .slice(-120) || 'image'
  );
}
export function assertAttachmentCount(sizes: number[]) {
  if (sizes.length > attachmentLimits.files)
    throw new BadRequestException('Too many files selected.');
  if (
    sizes.some(
      (n) => !Number.isInteger(n) || n <= 0 || n > attachmentLimits.fileBytes,
    )
  )
    throw new BadRequestException('File is empty or too large.');
  if (sizes.reduce((a, b) => a + b, 0) > attachmentLimits.totalBytes)
    throw new BadRequestException('Selected files are too large together.');
}
export async function processImage(
  bytes: Buffer,
  filename: string,
  declaredMime: string,
) {
  assertAttachmentCount([bytes.length]);
  const extension = filename.split('.').at(-1)?.toLowerCase();
  const format = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    ? 'jpeg'
    : bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : bytes.toString('ascii', 0, 4) === 'RIFF' &&
          bytes.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : null;
  if (
    !format ||
    !formats[format].extensions.some((x) => x === extension) ||
    declaredMime !== formats[format].mime
  )
    throw new BadRequestException('Unsupported file type or file content.');
  try {
    const pipeline = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: attachmentLimits.pixels,
      sequentialRead: true,
    });
    const metadata = await pipeline.metadata();
    if (
      metadata.format !== format ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > attachmentLimits.dimension ||
      metadata.height > attachmentLimits.dimension ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error();
    // No keepMetadata/withMetadata: re-encoding removes EXIF, GPS, XMP, IPTC and device data.
    const result = await pipeline
      .autoOrient()
      .toFormat(format)
      .timeout({ seconds: 10 })
      .toBuffer();
    assertAttachmentCount([result.length]);
    return {
      bytes: result,
      filename: safeFilename(filename),
      mediaType: formats[format].mime,
      byteSize: result.length,
      checksum: checksum(result),
    };
  } catch {
    throw new BadRequestException(
      'File could not be processed. Please remove it and try again.',
    );
  }
}

export interface AttachmentScanner {
  scan(bytes: Buffer): Promise<'CLEAN' | 'REJECTED'>;
}
/** Explicit development lifecycle stub. This is NOT malware detection. */
export class DevelopmentAttachmentScanner implements AttachmentScanner {
  scan(bytes: Buffer): Promise<'CLEAN'> {
    void bytes;
    return Promise.resolve('CLEAN');
  }
}
