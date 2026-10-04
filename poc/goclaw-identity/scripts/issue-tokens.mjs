import { randomBytes, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Refuse overwrite so existing credentials are not silently rotated.
const subjects = [
  { subject_type: 'user', subject_id: 'A' },
  { subject_type: 'user', subject_id: 'B' },
  { subject_type: 'group', subject_id: 'CRM-PoC' }
];
const credentials = subjects.map(subject => ({ ...subject, token: randomBytes(32).toString('base64url') }));
try {
  await writeFile(new URL('../.tokens.local', import.meta.url), JSON.stringify(credentials, null, 2), { flag: 'wx', mode: 0o600 });
  for (const { token } of credentials) console.log(createHash('sha256').update(token).digest('hex'));
} catch {
  console.error('Token file could not be created; existing files are never overwritten.');
  process.exitCode = 1;
}
