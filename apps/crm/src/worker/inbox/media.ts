/**
 * Staff images in R2. The key is the authorization: a request may read an object only when the key
 * starts with `org/<that organization>/` and matches the upload shape. A missing object and a key
 * from another organization are both "not found".
 */

export const MEDIA_MAX_BYTES = 1024 * 1024;
export const MEDIA_MAX_ATTACHMENTS = 4;
/** Multipart framing around a 1 MB file. A larger Content-Length is refused before the body is read. */
export const MEDIA_BODY_OVERHEAD = 64 * 1024;
const CRM_MEDIA_PREFIX = '/api/inbox/media/';

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type ImageMime = 'image/jpeg' | 'image/png';

export interface StaffMedia {
  key: string;
  url: string;
  mimeType: ImageMime;
  name?: string;
}

/** Year and month in Asia/Saigon, used in the object key. */
export function mediaYearMonth(now: Date): { yyyy: string; mm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return {
    yyyy: parts.find((part) => part.type === 'year')?.value ?? '0000',
    mm: parts.find((part) => part.type === 'month')?.value ?? '00',
  };
}

/** JPEG or PNG when the leading bytes match that type. A declared type is never enough on its own. */
export function sniffImage(bytes: Uint8Array): ImageMime | null {
  if (JPEG_MAGIC.every((byte, index) => bytes[index] === byte)) return 'image/jpeg';
  if (PNG_MAGIC.every((byte, index) => bytes[index] === byte)) return 'image/png';
  return null;
}

/** True for a key this Worker would store: `org/<id>/<yyyy>/<mm>/<uuid>.jpg|png`, with no `..`. */
export function isSafeMediaKey(key: string): boolean {
  if (key.includes('..') || key.includes('\\') || key.includes('\0')) return false;
  return /^org\/[A-Za-z0-9_-]+\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/.test(key);
}

/** The organization segment of a safe key is exactly `organizationId`. */
export function ownsMediaKey(organizationId: string, key: string): boolean {
  if (!organizationId || !isSafeMediaKey(key)) return false;
  return key.split('/')[1] === organizationId;
}

export function mediaUrl(key: string): string {
  return `${CRM_MEDIA_PREFIX}${key}`;
}

/** Key stored inside a CRM media URL. Anything else, including a CDN URL, is ignored. */
export function keyFromCrmMediaUrl(url: string): string | null {
  if (!url.startsWith(CRM_MEDIA_PREFIX)) return null;
  let key: string;
  try {
    key = decodeURIComponent(url.slice(CRM_MEDIA_PREFIX.length));
  } catch {
    return null;
  }
  return isSafeMediaKey(key) ? key : null;
}

export function filenameForKey(key: string, mimeType: ImageMime): string {
  const last = key.split('/').pop() ?? '';
  if (/^[A-Za-z0-9._-]+\.(jpg|png)$/.test(last)) return last;
  return mimeType === 'image/png' ? 'image.png' : 'image.jpg';
}

export interface UploadedMedia { key: string; url: string; mimeType: ImageMime; size: number }

/**
 * Stores `bytes` when they are a JPEG or PNG of at most 1 MB and the declared type is that same type.
 * `too_large` and `invalid` are the caller's 413 and 422.
 */
export async function storeInboxImage(
  bucket: R2Bucket, organizationId: string, declaredType: string, bytes: Uint8Array, now = new Date(),
): Promise<{ ok: true; media: UploadedMedia } | { ok: false; reason: 'too_large' | 'invalid' }> {
  if (bytes.byteLength > MEDIA_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const declared = declaredType.toLowerCase().split(';')[0]!.trim();
  const sniffed = sniffImage(bytes);
  if ((declared !== 'image/jpeg' && declared !== 'image/png') || sniffed !== declared) return { ok: false, reason: 'invalid' };
  const { yyyy, mm } = mediaYearMonth(now);
  const ext = sniffed === 'image/png' ? 'png' : 'jpg';
  const key = `org/${organizationId}/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: sniffed } });
  return { ok: true, media: { key, url: mediaUrl(key), mimeType: sniffed, size: bytes.byteLength } };
}

/** The objects behind `keys`, in order, or null when any key is unsafe, foreign, or missing. */
export async function loadOwnedAttachments(bucket: R2Bucket, organizationId: string, keys: string[]): Promise<StaffMedia[] | null> {
  if (keys.length > MEDIA_MAX_ATTACHMENTS) return null;
  const out: StaffMedia[] = [];
  for (const key of keys) {
    if (!ownsMediaKey(organizationId, key)) return null;
    const head = await bucket.head(key);
    const mimeType = head?.httpMetadata?.contentType;
    if (!head || (mimeType !== 'image/jpeg' && mimeType !== 'image/png')) return null;
    out.push({ key, url: mediaUrl(key), mimeType, name: filenameForKey(key, mimeType) });
  }
  return out;
}

export function asUploadFile(value: unknown): File | null {
  if (typeof File !== 'undefined' && value instanceof File) return value;
  if (Array.isArray(value)) return asUploadFile(value[0]);
  return null;
}
