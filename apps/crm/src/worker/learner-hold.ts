/** Customer hold window of the learner flow: three calendar months in Vietnam time. */

const VN_OFFSET_MS = 7 * 3_600_000;
export const HOLD_MONTHS = 3;

/**
 * Adds three calendar months in Asia/Ho_Chi_Minh and keeps the local time of day. A target day that
 * does not exist in the target month becomes that month's last day. Vietnam has no daylight saving,
 * so shifting by +7h, working on the UTC fields and shifting back is exact.
 */
export function holdExpiry(startIso: string): string {
  const local = new Date(Date.parse(startIso) + VN_OFFSET_MS);
  const month = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + HOLD_MONTHS, 1));
  const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const target = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(local.getUTCDate(), lastDay),
    local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds());
  return new Date(target - VN_OFFSET_MS).toISOString();
}

export interface HoldState {
  owner_user_id: string | null;
  hold_expires_at: string | null;
  /** The owner is still an active user with role sale or leader. */
  owner_eligible: boolean;
}

/**
 * A customer is held while it has an eligible owner and either a won learner lead or an unexpired
 * hold. An owner who moved to another role or was disabled voids the hold, so the customer returns to
 * the shared pool instead of staying locked to someone who can no longer work it.
 */
export function isHeld(contact: HoldState, hasWonLead: boolean, now: Date): boolean {
  if (!contact.owner_user_id || !contact.owner_eligible) return false;
  if (hasWonLead) return true;
  return contact.hold_expires_at !== null && Date.parse(contact.hold_expires_at) > now.getTime();
}

/** SQL twin of `owner_eligible` for a contact aliased `c`. */
export const OWNER_ELIGIBLE_SQL = `EXISTS (SELECT 1 FROM app_user ou WHERE ou.id = c.owner_user_id AND ou.status = 'active' AND ou.role IN ('sale', 'leader'))`;
/** SQL twin of `hasWonLead` for a contact aliased `c`. */
export const HAS_WON_SQL = `EXISTS (SELECT 1 FROM lead wl WHERE wl.contact_id = c.id AND wl.pipeline = 'learner' AND wl.stage = 'won')`;
/**
 * SQL twin of `!isHeld` for a contact aliased `c`; binds one ISO `now`. Contacts without an eligible
 * owner are in the pool; a contact with an eligible owner is in it only after its hold ran out and
 * only if it never won.
 */
export const IN_POOL_SQL = `(NOT ${OWNER_ELIGIBLE_SQL} OR (COALESCE(c.hold_expires_at, '') <= ? AND NOT ${HAS_WON_SQL}))`;

/** Columns that describe a customer's ownership, for a contact aliased `c`. */
export const CONTACT_STATE_COLUMNS = `c.id, c.display_name, c.owner_user_id, c.hold_expires_at, c.version,
  ${OWNER_ELIGIBLE_SQL} AS owner_eligible, ${HAS_WON_SQL} AS has_won,
  (SELECT team_id FROM app_user WHERE id = c.owner_user_id) AS owner_team_id,
  EXISTS (SELECT 1 FROM lead ll WHERE ll.contact_id = c.id AND ll.pipeline = 'learner') AS has_learner_lead`;

export interface ContactState {
  id: string;
  display_name: string;
  owner_user_id: string | null;
  hold_expires_at: string | null;
  version: number;
  owner_eligible: number;
  has_won: number;
  owner_team_id: string | null;
  has_learner_lead: number;
}

export const heldNow = (row: ContactState, now: Date) =>
  isHeld({ owner_user_id: row.owner_user_id, hold_expires_at: row.hold_expires_at, owner_eligible: row.owner_eligible === 1 }, row.has_won === 1, now);
