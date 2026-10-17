import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    remoteBindings: false,
    miniflare: {
      bindings: {
        TEST_MIGRATIONS: await readD1Migrations('../crm/migrations'),
        LMS_CONTENT_ORIGIN: 'https://content.test',
        STREAM_CUSTOMER_CODE: 'testcode',
        CONTENT_SIGNING_SECRET: 'test-secret',
      },
    },
  })],
  test: { include: ['test/**/*.test.ts'] },
}));
