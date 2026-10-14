import { lstat, mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES, cleanupOldImages, downloadImage } from '../src/image-fetch';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'image-fetch-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('downloadImage', () => {
  it('writes an allowed PNG and returns its path', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => new Response(PNG, { status: 200 }));
    const path = await downloadImage('https://f20-zpc.zdn.vn/a.png?token=secret', dir, fetchImpl as unknown as typeof fetch);

    expect(path).toMatch(/\.png$/);
    expect(path!.startsWith(dir)).toBe(true);
    expect(new Uint8Array(await readFile(path!))).toEqual(PNG);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://f20-zpc.zdn.vn/a.png?token=secret');
    expect(init).toMatchObject({ redirect: 'error' });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(await readdir(dir)).toEqual([path!.slice(dir.length + 1)]);
  });

  it('returns null for a wrong host', async () => {
    const fetchImpl = vi.fn(async () => new Response(PNG));
    const fetchAs = fetchImpl as unknown as typeof fetch;
    expect(await downloadImage('https://evil.example/a.png', dir, fetchAs)).toBeNull();
    expect(await downloadImage('https://zdn.vn.evil.com/a.png', dir, fetchAs)).toBeNull();
    expect(await downloadImage('https://notzdn.vn/a.png', dir, fetchAs)).toBeNull();
    expect(await downloadImage('http://zdn.vn/a.png', dir, fetchAs)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
  });

  it('returns null for a redirect', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.redirect !== 'error') return new Response(PNG, { status: 200 });
      throw new TypeError('redirect mode is set to error');
    });
    await expect(downloadImage('https://stc-zpc.zdn.vn/photo.jpg', dir, fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
    expect(await readdir(dir)).toEqual([]);
  });

  it('returns null when the body is over 10 MiB', async () => {
    let sent = 0;
    let cancelled = false;
    const total = MAX_IMAGE_BYTES + 1024 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= total) {
          controller.close();
          return;
        }
        const size = Math.min(256 * 1024, total - sent);
        const chunk = new Uint8Array(size);
        if (sent === 0) chunk.set(PNG);
        sent += size;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }));
    await expect(downloadImage('https://zdn.vn/big.png', dir, fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(total);
    expect(sent).toBeGreaterThan(MAX_IMAGE_BYTES);
    expect(await readdir(dir)).toEqual([]);
  });

  it('returns null for an HTML body', async () => {
    const fetchImpl = async () => new Response('<!DOCTYPE html><html><body>nope</body></html>', {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
    expect(await downloadImage('https://zdn.vn/a.png', dir, fetchImpl)).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('cleanupOldImages', () => {
  it('removes old files only', async () => {
    const oldFile = join(dir, 'old.png');
    const newFile = join(dir, 'new.png');
    const nested = join(dir, 'keep-dir');
    await writeFile(oldFile, PNG);
    await writeFile(newFile, PNG);
    await mkdir(nested);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(oldFile, old, old);
    await utimes(nested, old, old);

    await cleanupOldImages(dir);
    await expect(lstat(oldFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readFile(newFile)).length).toBe(PNG.length);
    expect((await lstat(nested)).isDirectory()).toBe(true);
    await expect(cleanupOldImages(join(dir, 'missing'))).resolves.toBeUndefined();
  });
});
