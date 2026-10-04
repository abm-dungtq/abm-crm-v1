import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const workerUrl = process.argv[2];
if (!workerUrl) throw new Error('Usage: node poc/d1-guard/scripts/race.mjs <worker-url>');
const base = new URL(workerUrl);
assert.ok(['http:', 'https:'].includes(base.protocol), 'Expected HTTP Worker URL');

async function snapshot() {
  const response = await fetch(new URL('/lead/L1', base));
  assert.equal(response.status, 200, 'Seed L1 before running the race');
  return response.json();
}

const initial = await snapshot();
let winners = 0;
for (let pair = 0; pair < 20; pair++) {
  const current = await snapshot();
  const results = await Promise.all([0, 1].map(async (writer) => {
    const response = await fetch(new URL('/lead/L1/stage', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: current.lead.version,
        stage: `Race-${pair}-${writer}`,
        idempotencyKey: randomUUID(),
      }),
    });
    assert.ok([200, 409].includes(response.status), `Unexpected status ${response.status}`);
    return response.json();
  }));
  assert.equal(results.filter((result) => result.ok === true).length, 1, `Pair ${pair}: winner count`);
  assert.equal(results.filter((result) => result.ok === false && result.code === 'STALE_VERSION').length, 1, `Pair ${pair}: stale count`);
  const after = await snapshot();
  assert.equal(after.lead.version, current.lead.version + 1, `Pair ${pair}: version`);
  assert.equal(after.audit, current.audit + 1, `Pair ${pair}: audit`);
  winners++;
  console.log(`PAIR_OK pair=${pair + 1} winners=1 stale=1`);
}
const final = await snapshot();
assert.equal(final.audit - initial.audit, winners);
assert.equal(final.lead.version - initial.lead.version, winners);
console.log(`RACE_OK pairs=20 winners=${winners} audit=${final.audit - initial.audit}`);
