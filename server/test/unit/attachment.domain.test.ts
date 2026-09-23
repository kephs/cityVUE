import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { BadRequestException } from '@nestjs/common';
import {
  attachmentLimits,
  assertAttachmentCount,
  checksum,
  processImage,
  safeFilename,
  DevelopmentAttachmentScanner,
} from '../../src/attachments/attachment.domain.js';
import {
  sanitizeLogContext,
  requestLogContext,
} from '../../src/common/logging/log-sanitization.js';
import type { Request } from 'express';

for (const format of ['jpeg', 'png', 'webp'] as const) {
  test(`F046 ${format}: decode/re-encode preserves image and strips fictional metadata`, async () => {
    const bytes = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#123456' },
    })
      .withExif({
        IFD0: {
          Make: 'FICTIONAL_CAMERA',
          Model: 'TEST_ONLY',
        },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '0/1 0/1 0/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '0/1 0/1 0/1',
        },
      })
      .toFormat(format)
      .toBuffer();
    const originalExif = (await sharp(bytes).metadata()).exif;
    assert.ok(originalExif);
    const tiff = ['II', 'MM'].includes(originalExif.toString('ascii', 0, 2))
      ? originalExif
      : originalExif.subarray(6);
    const little = tiff.toString('ascii', 0, 2) === 'II';
    const read16 = (offset: number) =>
      little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
    const read32 = (offset: number) =>
      little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
    const ifd = read32(4);
    const tags = Array.from({ length: read16(ifd) }, (_, i) =>
      read16(ifd + 2 + i * 12),
    );
    assert.ok(
      tags.includes(0x8825),
      'fixture really contains a fictional GPS IFD',
    );
    const result = await processImage(
      bytes,
      `fictional.${format}`,
      `image/${format}`,
    );
    const meta = await sharp(result.bytes).metadata();
    assert.equal(meta.format, format);
    assert.equal(meta.width, 12);
    assert.equal(meta.height, 8);
    for (const field of ['exif', 'xmp', 'iptc', 'icc', 'orientation'] as const)
      assert.equal(meta[field], undefined);
    assert.equal(result.checksum, checksum(result.bytes));
    assert.ok(!result.bytes.includes(Buffer.from('FICTIONAL_CAMERA')));
  });
}
test('F046 normalizes all EXIF orientations before removing metadata', async () => {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const image = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#abc123' },
    })
      .withMetadata({ orientation })
      .jpeg()
      .toBuffer();
    const result = await processImage(image, 'fixture.jpg', 'image/jpeg');
    const meta = await sharp(result.bytes).metadata();
    assert.equal(meta.width, orientation >= 5 ? 8 : 12);
    assert.equal(meta.height, orientation >= 5 ? 12 : 8);
    assert.equal(meta.orientation, undefined);
    assert.equal(meta.exif, undefined);
  }
});
test('F046 orientation processing preserves the expected pixel arrangement', async () => {
  const pixels = Buffer.from([
    10, 10, 10, 40, 40, 40, 80, 80, 80, 120, 120, 120, 170, 170, 170, 220, 220,
    220,
  ]);
  const expected = [
    [10, 40, 80, 120, 170, 220],
    [40, 10, 120, 80, 220, 170],
    [220, 170, 120, 80, 40, 10],
    [170, 220, 80, 120, 10, 40],
    [10, 80, 170, 40, 120, 220],
    [170, 80, 10, 220, 120, 40],
    [220, 120, 40, 170, 80, 10],
    [40, 120, 220, 10, 80, 170],
  ];
  for (const [index, order] of expected.entries()) {
    const input = await sharp(pixels, {
      raw: { width: 2, height: 3, channels: 3 },
    })
      .withMetadata({ orientation: index + 1 })
      .png()
      .toBuffer();
    const output = await processImage(input, 'orientation.png', 'image/png');
    const raw = await sharp(output.bytes).removeAlpha().raw().toBuffer();
    assert.deepEqual(
      [...raw].filter((_, i) => i % 3 === 0),
      order,
    );
  }
});
test('F046 rejects spoofed, truncated, malformed, zero-byte and unsupported content', async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const cases: [Buffer, string, string][] = [
    [png, 'wrong.jpg', 'image/jpeg'],
    [png, 'valid.png', 'application/octet-stream'],
    [png, 'valid.png', 'image/jpeg'],
    [Buffer.from('<html>fictional</html>'), 'report.pdf', 'application/pdf'],
    [Buffer.from('harmless text'), 'image.png', 'image/png'],
    [Buffer.from('MZ harmless simulated header'), 'image.jpg', 'image/jpeg'],
    [Buffer.alloc(0), 'empty.jpg', 'image/jpeg'],
    [png.subarray(0, 20), 'broken.png', 'image/png'],
    [Buffer.from([255, 216, 255, 0]), 'broken.jpg', 'image/jpeg'],
    [Buffer.from('RIFF0000WEBPinvalid'), 'broken.webp', 'image/webp'],
    [png, 'not-svg.svg', 'image/svg+xml'],
    [png, 'archive.zip', 'application/zip'],
  ];
  for (const [bytes, name, mime] of cases)
    await assert.rejects(processImage(bytes, name, mime), BadRequestException);
  const wide = await sharp({
    create: { width: 8193, height: 1, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    processImage(wide, 'wide.png', 'image/png'),
    BadRequestException,
  );
});
test('F046 rejects decoded pixels above the processing budget', async () => {
  const bytes = await sharp({
    create: { width: 4001, height: 4000, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  assert.ok(bytes.length < attachmentLimits.fileBytes);
  await assert.rejects(
    processImage(bytes, 'synthetic-pixels.png', 'image/png'),
    BadRequestException,
  );
});
test('F046 filename safety covers traversal, controls, Unicode, headers and bounded length', () => {
  for (const name of [
    '../example.jpg',
    '..\\example.jpg',
    '/path/example.jpg',
    'C:\\example.jpg',
    '%2e%2e%2fexample.jpg',
    'a\r\nInjected: bad.jpg',
    'quotes";file.jpg',
    '<script>alert.jpg',
    '日本語-😀.png',
    'x'.repeat(500) + '.jpg',
  ]) {
    const clean = safeFilename(name);
    assert.match(clean, /^[a-zA-Z0-9._ -]{1,120}$/);
    assert.ok(!clean.includes('..'));
    assert.ok(!/[\\/%<>:;\r\n]/.test(clean));
  }
  assert.equal(safeFilename('same.jpg'), safeFilename('same.jpg'));
});
test('F046 server count and aggregate limits are independent of browser validation', () => {
  assertAttachmentCount([
    attachmentLimits.fileBytes,
    attachmentLimits.fileBytes,
    attachmentLimits.fileBytes,
  ]);
  for (const sizes of [
    [0],
    [-1],
    [NaN],
    [attachmentLimits.fileBytes + 1],
    Array(6).fill(1),
    Array(4).fill(attachmentLimits.fileBytes),
  ])
    assert.throws(() => {
      assertAttachmentCount(sizes);
    }, BadRequestException);
});
test('F046 development scanner is a lifecycle stub, not malware detection', async () => {
  assert.equal(
    await new DevelopmentAttachmentScanner().scan(Buffer.from('synthetic')),
    'CLEAN',
  );
});
test('F046 logging excludes multipart, bytes, filenames, EXIF, capabilities and provider paths', () => {
  const secret = 'FICTIONAL_ATTACHMENT_PRIVATE_MARKER';
  const context = sanitizeLogContext({
    body: Buffer.from(secret),
    file: { buffer: Buffer.from(secret), originalname: secret },
    headers: { 'x-reqro-attachment': secret },
    filename: secret,
    exif: secret,
    storagePath: secret,
    storageKey: secret,
  });
  assert.deepEqual(context, {});
  const req = {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${secret}` },
    body: secret,
    route: { path: '/intake/attachments/batches/:batchId/files/:fileId' },
    url: secret,
  } as unknown as Request;
  assert.ok(!JSON.stringify(requestLogContext(req)).includes(secret));
});
