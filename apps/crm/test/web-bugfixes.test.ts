import { expect, test } from 'vitest';
import { canViewAudit } from '../src/web/actor-context';
import { parseWonAmount } from '../src/web/format';
import { leadListPath, accountListPath } from '../src/web/list-query';

test('lead filters are sent to the API rather than applied to a limited response', () => {
  const path = leadListPath({ tab: 'won', q: 'Lộc Thọ', stage: 'won', department: 'dep-kd' });
  const url = new URL(path, 'http://crm.test');
  expect(url.pathname).toBe('/leads');
  expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'page', status: 'won', q: 'Lộc Thọ', stage: 'won', department: 'dep-kd' });
  expect(new URL(leadListPath({ tab: 'all' }), url).searchParams.has('status')).toBe(false);
});

test('customer search sends the query to the server', () => {
  const url = new URL(accountListPath(' Lộc & Thọ '), 'http://crm.test');
  expect(url.pathname).toBe('/accounts');
  expect(url.searchParams.get('q')).toBe('Lộc & Thọ');
  expect(url.searchParams.get('view')).toBe('page');
});

test('Won amounts accept comma thousands and reject decimal or malformed amounts', () => {
  for (const value of ['350000000', '350,000,000', '350.000.000', '350 000 000']) expect(parseWonAmount(value)).toBe(350000000);
  for (const value of ['', '0', '350,5', '35,,000', 'abc', '-100', '1000000000000001']) expect(parseWonAmount(value)).toBeNull();
});

test('audit visibility excludes Sale and includes the roles allowed by the API', () => {
  expect(canViewAudit('sale')).toBe(false);
  for (const role of ['leader', 'head', 'director', 'admin'] as const) expect(canViewAudit(role)).toBe(true);
});
