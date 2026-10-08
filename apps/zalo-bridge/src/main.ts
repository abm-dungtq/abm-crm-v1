import { fileURLToPath } from 'node:url';
import { AccountManager } from './account-manager';
import { CommandRunner } from './command-runner';
import { ConfigError, consoleLogger as log, errorCode, loadConfig, type BridgeConfig } from './config';
import { CrmClient } from './crm-client';
import { GoClawClient } from './goclaw-client';
import { zcaConnector } from './zalo-client';

/** Zalo sessions are stored next to the package, in a git-ignored directory. */
const SESSIONS_DIR = fileURLToPath(new URL('../.sessions/', import.meta.url));
/** Events held back by an unreachable Worker are retried this often. */
const FLUSH_INTERVAL_MS = 15_000;
/** Shutdown waits this long for running commands to report before exiting. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main() {
  let config: BridgeConfig;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : 'Không đọc được cấu hình');
    process.exit(1);
  }

  const crm = new CrmClient({ baseUrl: config.crmBaseUrl, secret: config.bridgeSecret, pollWaitSeconds: config.pollWaitSeconds, log });
  const goclaw = new GoClawClient({ baseUrl: config.goclawBaseUrl, apiKey: config.goclawApiKey });
  const accounts = new AccountManager({
    connector: zcaConnector, sessionsDir: SESSIONS_DIR, log,
    emit: (events) => void crm.pushEvents(events),
  });
  const runner = new CommandRunner({
    crm, goclaw, accounts, sendMinDelayMs: config.sendMinDelayMs, sendMaxDelayMs: config.sendMaxDelayMs, log,
  });

  const controller = new AbortController();
  const flushTimer = setInterval(() => void crm.flush(), FLUSH_INTERVAL_MS);
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'bridge.stopping', { signal });
    controller.abort();
    clearInterval(flushTimer);
    accounts.stopAll();
    await Promise.race([
      runner.idle().then(() => crm.flush()),
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
    ]);
    log('info', 'bridge.stopped', { pendingEvents: crm.pendingCount });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  log('info', 'bridge.starting', {});
  await accounts.startSaved();
  await runner.run(controller.signal);
}

process.on('unhandledRejection', (error) => {
  log('error', 'bridge.unhandled_rejection', { code: errorCode(error) });
  process.exit(1);
});

main().catch((error: unknown) => {
  log('error', 'bridge.crashed', { code: errorCode(error) });
  process.exit(1);
});
