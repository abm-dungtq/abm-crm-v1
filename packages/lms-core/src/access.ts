export const ACCESS_ENROLLMENT_STATUSES = ['confirmed', 'studying', 'completed'] as const;

export interface AccessFacts {
  programId: string;
  /** True when the contact has an enrollment in ACCESS_ENROLLMENT_STATUSES for the program's class. */
  enrolled: boolean;
  /** Latest starts_at of a non-cancelled class_session of the program's class (ISO), or null. */
  lastSessionAt: string | null;
  reviewDays: number | null;
  /** Live (revoked_at IS NULL) lms_access rows for this contact and program. */
  manual: { mode: 'grant' | 'block'; expiresAt: string | null }[];
}

export type AccessState = { state: 'open'; until: string | null } | { state: 'expired'; endedAt: string } | { state: 'none' };

/** Enrollment ∪ live grant, minus live block. Review window = last session + reviewDays days. */
export function resolveAccess(f: AccessFacts, nowIso: string): AccessState {
  for (const row of f.manual) {
    if (row.mode === 'block' && (row.expiresAt === null || row.expiresAt > nowIso)) {
      return { state: 'none' };
    }
  }

  // Several sources may open the program; report the longest window (null = no end).
  const opens: (string | null)[] = f.manual
    .filter((row) => row.mode === 'grant' && (row.expiresAt === null || row.expiresAt > nowIso))
    .map((row) => row.expiresAt);
  let expired: string | null = null;
  if (f.enrolled) {
    if (f.reviewDays === null || f.lastSessionAt === null) {
      opens.push(null);
    } else {
      const end = new Date(Date.parse(f.lastSessionAt) + f.reviewDays * 86400000).toISOString();
      if (nowIso < end) opens.push(end);
      else expired = end;
    }
  }

  if (opens.length > 0) {
    const until = opens.includes(null) ? null : (opens as string[]).reduce((a, b) => (b > a ? b : a));
    return { state: 'open', until };
  }
  if (expired) return { state: 'expired', endedAt: expired };
  return { state: 'none' };
}
