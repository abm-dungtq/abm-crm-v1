#!/usr/bin/env node
// Uploads a local MP4 recording to Cloudflare Stream via tus (50 MiB chunks, signed URLs required)
// and attaches the resulting streamUid to a class lesson in CRM. Never prints any token.

import { createReadStream, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_CRM = 'https://abm-crm-eval.ngulongyquan.workers.dev';
const ABM_DIR = join(homedir(), '.abm');
const PUBLISH_TOKEN_PATH = join(ABM_DIR, 'lms-publish-token');
const STREAM_TOKEN_PATH = join(ABM_DIR, 'stream-api-token');
const ACCOUNT_ID_PATH = join(ABM_DIR, 'cloudflare-account-id');
const CHUNK_SIZE = 50 * 1024 * 1024;
const MAX_RETRIES = 5;

function parseArgs(argv) {
  const opts = {
    classId: '',
    sectionId: '',
    title: '',
    file: '',
    account: '',
    crm: DEFAULT_CRM,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--class' && argv[i + 1]) {
      opts.classId = argv[++i].trim();
    } else if (arg === '--section' && argv[i + 1]) {
      opts.sectionId = argv[++i].trim();
    } else if (arg === '--title' && argv[i + 1]) {
      opts.title = argv[++i].trim();
    } else if (arg === '--file' && argv[i + 1]) {
      opts.file = argv[++i];
    } else if (arg === '--account' && argv[i + 1]) {
      opts.account = argv[++i].trim();
    } else if (arg === '--crm' && argv[i + 1]) {
      opts.crm = argv[++i].trim().replace(/\/+$/, '');
    } else {
      throw new Error(`Tham số không hợp lệ hoặc thiếu giá trị: ${arg}`);
    }
  }
  return opts;
}

function readSecretFile(filePath, missingMessage) {
  try {
    const value = readFileSync(filePath, 'utf8').trim();
    if (!value) throw new Error('empty');
    return value;
  } catch {
    console.error(missingMessage);
    process.exit(1);
  }
}

async function readChunkBuffer(filePath, start, end) {
  const chunks = [];
  for await (const chunk of createReadStream(filePath, { start, end })) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.classId || !opts.sectionId || !opts.title || !opts.file) {
    console.error('Usage: node scripts/lms-upload-video.mjs --class <classId> --section <sectionId> --title "<title>" --file <recording.mp4> [--account <id>] [--crm <url>]');
    process.exitCode = 1;
    return;
  }

  const publishToken = readSecretFile(
    PUBLISH_TOKEN_PATH,
    'Chưa có token đăng bài: chạy scripts/issue-lms-publish-token.mjs',
  );
  const streamToken = readSecretFile(
    STREAM_TOKEN_PATH,
    'Chưa có Stream API token tại ~/.abm/stream-api-token',
  );
  const accountId = opts.account || readSecretFile(
    ACCOUNT_ID_PATH,
    'Thiếu Cloudflare Account ID: truyền --account <id> hoặc lưu tại ~/.abm/cloudflare-account-id',
  );

  const stat = statSync(opts.file);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`File video không hợp lệ hoặc rỗng: ${opts.file}`);
  }
  const totalBytes = stat.size;
  const nameB64 = Buffer.from(opts.title, 'utf8').toString('base64');

  const createUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/stream?direct_user=true`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${streamToken}`,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(totalBytes),
      'Upload-Metadata': `name ${nameB64},requiresignedurls`,
    },
  });

  if (!createRes.ok) {
    throw new Error(`Không khởi tạo được tus upload trên Cloudflare Stream (HTTP ${createRes.status})`);
  }

  const locationHeader = createRes.headers.get('location');
  if (!locationHeader) {
    throw new Error('Cloudflare Stream không trả về header Location cho tus upload');
  }
  const uploadUrl = new URL(locationHeader, 'https://api.cloudflare.com').toString();
  let streamUid = createRes.headers.get('stream-media-id')?.trim() ?? '';
  if (!streamUid) {
    const uidMatch = uploadUrl.match(/\/([a-f0-9]{32})(?:[/?]|$)/i);
    if (uidMatch) streamUid = uidMatch[1].toLowerCase();
  }
  if (!streamUid) {
    throw new Error('Không đọc được stream-media-id từ Cloudflare Stream');
  }

  let offset = 0;
  let retries = 0;
  while (offset < totalBytes) {
    const end = Math.min(offset + CHUNK_SIZE, totalBytes) - 1;
    const chunkBuf = await readChunkBuffer(opts.file, offset, end);
    try {
      const patchRes = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${streamToken}`,
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: chunkBuf,
      });
      if (!patchRes.ok) {
        throw new Error(`PATCH chunk HTTP ${patchRes.status}`);
      }
      const nextOffsetHeader = patchRes.headers.get('upload-offset');
      offset = nextOffsetHeader !== null ? Number(nextOffsetHeader) : end + 1;
      retries = 0;
      const pct = Math.min(100, Math.round((offset / totalBytes) * 100));
      console.log(`${pct}%`);
    } catch (err) {
      retries += 1;
      if (retries > MAX_RETRIES) {
        throw new Error(`Tải video thất bại sau ${MAX_RETRIES} lần thử lại ở offset ${offset}: ${err instanceof Error ? err.message : String(err)}`);
      }
      const headRes = await fetch(uploadUrl, {
        method: 'HEAD',
        headers: {
          Authorization: `Bearer ${streamToken}`,
          'Tus-Resumable': '1.0.0',
        },
      }).catch(() => null);
      const serverOffset = headRes?.headers?.get('upload-offset');
      if (serverOffset !== null && serverOffset !== undefined && !Number.isNaN(Number(serverOffset))) {
        offset = Number(serverOffset);
      }
    }
  }

  const attachRes = await fetch(`${opts.crm}/api/lms-publish/videos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publishToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      classId: opts.classId,
      sectionId: opts.sectionId,
      title: opts.title,
      streamUid,
    }),
  });
  const payload = await attachRes.json().catch(() => null);
  if (!attachRes.ok || !payload?.ok) {
    const msg = payload?.error?.message ?? payload?.error ?? `HTTP ${attachRes.status}`;
    console.error(`HTTP ${attachRes.status}: ${msg}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Đã gắn video ${streamUid} vào phần ${opts.sectionId}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Lỗi không rõ');
  process.exitCode = 1;
}
