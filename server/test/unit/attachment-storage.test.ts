import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  LocalAttachmentStorage,
  newStorageKey,
} from '../../src/attachments/attachment-storage.js';
test('F046 private local storage uses opaque keys, isolated Organizations and exclusive immutable bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reqro-f046-storage-'));
  const storage = new LocalAttachmentStorage(root),
    org = randomUUID(),
    other = randomUUID(),
    key = newStorageKey();
  try {
    const bytes = Buffer.from('harmless synthetic storage bytes');
    await storage.write(org, key, bytes);
    assert.deepEqual(await storage.read(org, key), bytes);
    await assert.rejects(storage.write(org, key, Buffer.from('replacement')));
    assert.deepEqual(await storage.read(org, key), bytes);
    await assert.rejects(storage.read(other, key));
    for (const invalid of [
      '../bad',
      '..\\bad',
      '/tmp/bad',
      'C:\\bad',
      '%2fsecret',
    ]) {
      await assert.rejects(storage.write(org, invalid, bytes));
      await assert.rejects(storage.read(invalid, key));
    }
    const stream = await storage.stream(org, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal((await storage.inventory()).length, 1);
    await storage.remove(org, key);
    await storage.remove(org, key);
    await assert.rejects(storage.read(org, key));
    assert.equal((await storage.inventory()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
