// Measures the customer handoff check against hand-written labels before a mode moves from shadow to active.
// Usage (from apps/crm): node --env-file=.dev.vars scripts/eval-handoff-check.mjs [labels.jsonl]
// Needs TYPESAFE_API_KEY. Labels are lines of {"text": "...", "label": "<category>|none"}; never put customer data in them.
import { readFileSync } from 'node:fs';
import { classifyWithJev, jevCategory, matchHandoffRule } from '../src/worker/inbox/decision-layer.ts';

const file = process.argv[2] ?? new URL('./fixtures/handoff-labels.jsonl', import.meta.url);
const rows = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
const env = { TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY, JEV_MODEL: process.env.JEV_MODEL };
if (!env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is not set');

const results = [];
for (const row of rows) {
  const rule = matchHandoffRule(row.text);
  const jev = await classifyWithJev(env, row.text);
  results.push({ ...row, rule, jev: jev.ok ? jev.answer : { error: jev.error } });
}

const errors = results.filter((r) => 'error' in r.jev);
console.log(`labels: ${rows.length}, Jev errors: ${errors.length}${errors.length ? ` (${[...new Set(errors.map((r) => r.jev.error))].join(', ')})` : ''}`);
const ruleHits = results.filter((r) => r.rule);
console.log(`rules: ${ruleHits.length} hits, ${ruleHits.filter((r) => r.rule !== r.label).length} wrong`);

// The decision the check makes in active mode: a rule hit, else Jev's category at or above the threshold.
for (const threshold of [0.5, 0.6, 0.7, 0.75, 0.8, 0.9]) {
  let exact = 0; let falseHandoff = 0; let missedHandoff = 0;
  for (const r of results) {
    const decided = r.rule ?? (('choice' in r.jev && jevCategory(r.jev, threshold)) || 'none');
    if (decided === r.label) exact += 1;
    if (r.label === 'none' && decided !== 'none') falseHandoff += 1;
    if (r.label !== 'none' && decided === 'none') missedHandoff += 1;
  }
  console.log(`threshold ${threshold}: exact ${exact}/${rows.length}, false handoffs ${falseHandoff}, missed handoffs ${missedHandoff}`);
}

console.log('\nmismatches (label <- rule / jev choice@confidence):');
for (const r of results) {
  const jevText = 'choice' in r.jev ? `${r.jev.choice}@${r.jev.confidence.toFixed(2)}` : r.jev.error;
  if ((r.rule ?? ('choice' in r.jev ? r.jev.choice : '')) !== r.label) console.log(`  ${r.label} <- ${r.rule ?? '-'} / ${jevText}: ${r.text}`);
}
