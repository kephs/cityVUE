import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  unlink,
  lstat,
  readdir,
  realpath,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { requestUuid } from '../service-request/staff-request-scope.js';

export interface AttachmentStorage {
  write(organizationId: string, key: string, bytes: Buffer): Promise<void>;
  read(organizationId: string, key: string): Promise<Buffer>;
  stream(organizationId: string, key: string): Promise<Readable>;
  remove(organizationId: string, key: string): Promise<void>;
}
export const newStorageKey = () => randomUUID();

/** Fixed private root. Not registered with any static-file middleware. Exclusive writes only. */
export class LocalAttachmentStorage implements AttachmentStorage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private async path(organizationId: string, key: string) {
    if (!requestUuid.test(organizationId) || !requestUuid.test(key))
      throw new Error('Invalid object identity');
    const directory = join(this.root, organizationId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (
      (await lstat(this.root)).isSymbolicLink() ||
      (await lstat(directory)).isSymbolicLink() ||
      resolve(await realpath(directory)) !== directory
    )
      throw new Error('Invalid storage boundary');
    return join(directory, key);
  }
  async write(org: string, key: string, bytes: Buffer) {
    const path = await this.path(org, key);
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
    } catch (error) {
      await file.close();
      await unlink(path).catch(() => undefined);
      throw error;
    }
    await file.close();
  }
  async read(org: string, key: string) {
    const path = await this.path(org, key);
    if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink())
      throw new Error('Invalid object');
    return readFile(path);
  }
  async stream(org: string, key: string) {
    const path = await this.path(org, key);
    if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink())
      throw new Error('Invalid object');
    return createReadStream(path);
  }
  async remove(org: string, key: string) {
    try {
      await unlink(await this.path(org, key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  async inventory() {
    const result: { organizationId: string; key: string; modifiedAt: Date }[] =
      [];
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const org of await readdir(this.root)) {
      if (
        !requestUuid.test(org) ||
        (await lstat(join(this.root, org))).isSymbolicLink()
      )
        continue;
      for (const key of await readdir(join(this.root, org))) {
        if (!requestUuid.test(key)) continue;
        const stat = await lstat(await this.path(org, key));
        if (stat.isFile() && !stat.isSymbolicLink())
          result.push({ organizationId: org, key, modifiedAt: stat.mtime });
      }
    }
    return result;
  }
}
