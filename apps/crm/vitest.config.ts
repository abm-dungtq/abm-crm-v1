import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    remoteBindings: false,
    miniflare: {
      // Tests default to the evaluation identity path; password-mode tests opt in per request.
      // The handoff check is off and has no TypeSafe key, so no test reaches the network; its tests opt in per call.
      bindings: {
        TEST_MIGRATIONS: await readD1Migrations('./migrations'), AUTH_MODE: '', DEMO_EXPORT: process.env.DEMO_EXPORT ?? '',
        HANDOFF_NET_MODE: '', JEV_INTENT_MODE: '', TYPESAFE_API_KEY: '',
      },
    },
  })],
  test: { include: ['test/**/*.test.ts'] },
}));
