#!/usr/bin/env node
// Splits an HTML handbook into lessons, injects the postMessage bridge, and publishes it to CRM.
// Never prints any token value.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { injectBridge, parseHandbook } from './lms-html.mjs';

const DEFAULT_CRM = 'https://abm-crm-eval.ngulongyquan.workers.dev';
const TOKEN_PATH = join(homedir(), '.abm', 'lms-publish-token');
const MAX_HTML_CHARS = 3_000_000;

function parseArgs(argv) {
  const opts = {
    classId: '',
    file: '',
    title: '',
    groupsRaw: '',
    skipRaw: 'home',
    hide: '',
    crm: DEFAULT_CRM,
    dryRun: false,
    listClasses: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--list-classes') {
      opts.listClasses = true;
    } else if (arg === '--class' && argv[i + 1]) {
      opts.classId = argv[++i].trim();
    } else if (arg === '--file' && argv[i + 1]) {
      opts.file = argv[++i];
    } else if (arg === '--title' && argv[i + 1]) {
      opts.title = argv[++i].trim();
    } else if (arg === '--groups' && argv[i + 1] !== undefined) {
      opts.groupsRaw = argv[++i];
    } else if (arg === '--skip' && argv[i + 1] !== undefined) {
      opts.skipRaw = argv[++i];
    } else if (arg === '--hide' && argv[i + 1] !== undefined) {
      opts.hide = argv[++i];
    } else if (arg === '--crm' && argv[i + 1]) {
      opts.crm = argv[++i].trim().replace(/\/+$/, '');
    } else {
      throw new Error(`Tham số không hợp lệ hoặc thiếu giá trị: ${arg}`);
    }
  }
  return opts;
}

function parseGroups(groupsRaw) {
  if (!groupsRaw || !groupsRaw.trim()) return [];
  return groupsRaw
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((pair) => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx <= 0) {
        throw new Error(`Định dạng --groups không hợp lệ tại "${pair}" (cần prefix=Tên nhóm)`);
      }
      return {
        prefix: pair.slice(0, eqIdx).trim(),
        title: pair.slice(eqIdx + 1).trim(),
      };
    });
}

function parseSkip(skipRaw) {
  if (!skipRaw || !skipRaw.trim()) return [];
  return skipRaw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function readPublishToken() {
  try {
    const token = readFileSync(TOKEN_PATH, 'utf8').trim();
    if (!token) throw new Error('empty');
    return token;
  } catch {
    console.error('Chưa có token đăng bài: chạy scripts/issue-lms-publish-token.mjs');
    process.exit(1);
  }
}

function extractApiError(payload, status) {
  if (payload && typeof payload === 'object') {
    if (payload.error && typeof payload.error === 'object' && payload.error.message) {
      const fields = payload.error.fields ? ` (${JSON.stringify(payload.error.fields)})` : '';
      return `${payload.error.message}${fields}`;
    }
    if (typeof payload.error === 'string') return payload.error;
    if (typeof payload.message === 'string') return payload.message;
  }
  return `Lỗi HTTP ${status}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.listClasses) {
    const token = readPublishToken();
    const res = await fetch(`${opts.crm}/api/lms-publish/classes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) {
      console.error(`HTTP ${res.status}: ${extractApiError(payload, res.status)}`);
      process.exitCode = 1;
      return;
    }
    console.log('id | lớp | khoá | có chương trình');
    for (const c of payload.data ?? []) {
      const hasProg = c.programId ? `có (v${c.contentVersion ?? 1})` : 'chưa';
      console.log(`${c.id} | ${c.name} | ${c.courseName} | ${hasProg}`);
    }
    return;
  }

  if (!opts.file) {
    console.error('Thiếu tham số bắt buộc: --file <đường dẫn file HTML>');
    process.exitCode = 1;
    return;
  }
  if (!opts.dryRun && !opts.classId) {
    console.error('Thiếu tham số bắt buộc: --class <classId>');
    process.exitCode = 1;
    return;
  }

  const rawHtml = readFileSync(opts.file, 'utf8');
  const groups = parseGroups(opts.groupsRaw);
  const skip = parseSkip(opts.skipRaw);
  const parsed = parseHandbook(rawHtml, { skip, groups });
  const finalTitle = opts.title || parsed.title;
  const finalHtml = injectBridge(rawHtml, { hideSelector: opts.hide || undefined });

  if (finalHtml.length > MAX_HTML_CHARS) {
    console.error(`File HTML sau khi gắn bridge vượt quá giới hạn ${MAX_HTML_CHARS.toLocaleString('en-US')} ký tự (${finalHtml.length.toLocaleString('en-US')})`);
    process.exitCode = 1;
    return;
  }

  for (const warning of parsed.warnings) {
    console.warn(`Cảnh báo: ${warning}`);
  }

  if (opts.dryRun) {
    console.log(`Tiêu đề: ${finalTitle}`);
    console.log(`Số phần: ${parsed.lessons.length}`);
    for (const lesson of parsed.lessons) {
      console.log(`${lesson.sectionId} — ${lesson.groupTitle ?? '-'} — ${lesson.title}`);
    }
    return;
  }

  const token = readPublishToken();
  const res = await fetch(`${opts.crm}/api/lms-publish/programs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      classId: opts.classId,
      title: finalTitle,
      html: finalHtml,
      lessons: parsed.lessons,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.ok) {
    console.error(`HTTP ${res.status}: ${extractApiError(payload, res.status)}`);
    process.exitCode = 1;
    return;
  }

  const { programId, contentVersion, lessons, hidden } = payload.data;
  console.log(`Đã đăng: chương trình ${programId}, phiên bản ${contentVersion}, ${lessons} phần, ${hidden} phần bị gỡ`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Lỗi không rõ');
  process.exitCode = 1;
}
