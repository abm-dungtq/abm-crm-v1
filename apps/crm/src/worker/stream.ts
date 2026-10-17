import type { Env } from './env';

interface StreamCopyResponse {
  success?: boolean;
  result?: {
    uid?: string;
  };
}

/**
 * Requests Cloudflare Stream to copy a video from a public HTTPS URL with signed URLs required.
 * Stream copy is asynchronous: a 200 response means the job was accepted, not that playback is ready.
 */
export async function streamCopyFromUrl(env: Env, url: string, name: string): Promise<{ uid: string }> {
  if (!env.STREAM_API_TOKEN || !env.STREAM_ACCOUNT_ID) {
    throw new Error('STREAM_NOT_CONFIGURED');
  }
  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.STREAM_ACCOUNT_ID}/stream/copy`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STREAM_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          meta: { name },
          requireSignedURLs: true,
        }),
      },
    );
  } catch {
    throw new Error('STREAM_COPY_FAILED');
  }
  if (!response.ok) {
    throw new Error('STREAM_COPY_FAILED');
  }
  const json = (await response.json().catch(() => null)) as StreamCopyResponse | null;
  if (!json || json.success !== true || typeof json.result?.uid !== 'string' || !json.result.uid) {
    throw new Error('STREAM_COPY_FAILED');
  }
  return { uid: json.result.uid };
}
