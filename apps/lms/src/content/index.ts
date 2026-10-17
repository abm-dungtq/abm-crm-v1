import { verifyContentPath } from '@abm/lms-core';

export interface ContentEnv {
  LMS_CONTENT: R2Bucket;
  CONTENT_SIGNING_SECRET: string;
  LMS_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: ContentEnv): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const url = new URL(request.url);
    // The value goes into frame-ancestors verbatim; an empty one would silently block every frame.
    if (!env.LMS_ORIGIN) {
      return new Response('Chưa cấu hình LMS_ORIGIN', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const verified = await verifyContentPath(url, env.CONTENT_SIGNING_SECRET, Date.now());
    if (!verified) {
      return new Response('Liên kết đã hết hạn, hãy mở lại bài học', {
        status: 403,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }
    const key = `programs/${verified.programId}/v${verified.contentVersion}.html`;
    const obj = await env.LMS_CONTENT.get(key);
    if (!obj) {
      return new Response('Không tìm thấy nội dung bài học', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }
    const headers = new Headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${env.LMS_ORIGIN}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    return new Response(request.method === 'HEAD' ? null : obj.body, {
      status: 200,
      headers,
    });
  },
};
