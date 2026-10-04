import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    remoteBindings: false,
    miniflare: {
      // Tests default to the evaluation identity path; password-mode tests opt in per request.
      bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations'), AUTH_MODE: '' },
    },
  })],
  test: { include: ['test/**/*.test.ts'] },
}));
