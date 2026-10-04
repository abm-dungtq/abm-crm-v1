/** Build the server filters used by list pages; URLSearchParams preserves search text safely. */
export function leadListPath(search: { tab?: string; q?: string; stage?: string; department?: string }) {
  const params = new URLSearchParams({ view: 'page' });
  const status = search.tab ?? 'active';
  if (status !== 'all') params.set('status', status);
  if (search.q?.trim()) params.set('q', search.q.trim());
  if (search.stage) params.set('stage', search.stage);
  if (search.department) params.set('department', search.department);
  return `/leads?${params}`;
}

export function accountListPath(q: string) {
  const params = new URLSearchParams({ view: 'page' });
  if (q.trim()) params.set('q', q.trim());
  return `/accounts?${params}`;
}
