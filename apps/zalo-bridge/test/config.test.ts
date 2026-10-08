import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

const base = { CRM_BASE_URL: 'https://crm.example.test/', BRIDGE_SECRET: 'secret-value', GOCLAW_API_KEY: 'key-value' };

describe('loadConfig', () => {
  it('names a missing BRIDGE_SECRET without printing any value', () => {
    const env = { ...base, BRIDGE_SECRET: undefined };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/BRIDGE_SECRET/);
    try {
      loadConfig(env);
    } catch (error) {
      expect((error as Error).message).not.toContain('key-value');
    }
  });

  it('lists every missing required variable', () => {
    expect(() => loadConfig({})).toThrow(/CRM_BASE_URL, BRIDGE_SECRET, GOCLAW_API_KEY/);
  });

  it('applies defaults and strips trailing slashes', () => {
    expect(loadConfig(base)).toEqual({
      crmBaseUrl: 'https://crm.example.test',
      bridgeSecret: 'secret-value',
      goclawApiKey: 'key-value',
      goclawBaseUrl: 'http://127.0.0.1:18790/v1',
      sendMinDelayMs: 1500,
      sendMaxDelayMs: 4000,
      pollWaitSeconds: 20,
    });
  });

  it('rejects malformed optional values', () => {
    expect(() => loadConfig({ ...base, POLL_WAIT_SECONDS: 'abc' })).toThrow(/POLL_WAIT_SECONDS/);
    expect(() => loadConfig({ ...base, POLL_WAIT_SECONDS: '60' })).toThrow(/POLL_WAIT_SECONDS/);
    expect(() => loadConfig({ ...base, SEND_MIN_DELAY_MS: '5000', SEND_MAX_DELAY_MS: '1000' })).toThrow(/SEND_MAX_DELAY_MS/);
    expect(() => loadConfig({ ...base, CRM_BASE_URL: 'not a url' })).toThrow(/CRM_BASE_URL/);
  });
});
