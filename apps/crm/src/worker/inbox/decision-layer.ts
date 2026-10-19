import type { Env } from '../env';

/**
 * Second check on the customer bot's handoff. The bot hands a conversation to people by writing a HANDOFF line, and
 * this layer decides independently from the customer's own words whether the turn needs a person, so a forgotten
 * line no longer leaves the customer with the bot. Deterministic rules decide first; TypeSafe Jev, a small
 * classification model, decides the turns the rules do not catch. Every failure means "no decision": the bot's
 * reply and its own HANDOFF line still apply as before.
 */

/** `off`: not evaluated. `shadow`: evaluated and logged, never acted on. `active`: acted on. */
export type DecisionMode = 'off' | 'shadow' | 'active';

export const HANDOFF_CATEGORIES = {
  payment_done: {
    reason: 'Khách báo đã chuyển khoản hoặc chốt đăng ký',
    criteria: 'The customer says they have paid or transferred money, sends a receipt, or confirms they want to register now',
  },
  wants_human: {
    reason: 'Khách muốn gặp người thật',
    criteria: 'The customer asks to talk to a real person, a staff member or a manager, or asks to be called',
  },
  complaint: {
    reason: 'Khách khiếu nại',
    criteria: 'The customer complains, is angry, demands a refund, or calls the company a scam',
  },
  access_problem: {
    reason: 'Khách báo lỗi truy cập',
    criteria: 'The customer cannot log in or cannot open a course, video, link or group they were given',
  },
  schedule_or_link: {
    reason: 'Khách hỏi lịch, link hoặc địa điểm học',
    criteria: 'The customer asks for a class schedule or start date, a Zoom or meeting link, a venue address, or to book a consultation call',
  },
  special_pricing: {
    reason: 'Khách hỏi giảm giá hoặc báo giá riêng',
    criteria: 'The customer asks for a discount, instalments or an exception, or a quote for an in-house, done-with-you or LMS program',
  },
} as const;
export type HandoffCategory = keyof typeof HANDOFF_CATEGORIES;

/** Jev's label for a turn that needs no person. */
const NONE = 'none';
const NONE_CRITERIA = 'Anything else: questions about programs and their content, general prices, greetings, thanks, small talk';

/**
 * Rules match text with Vietnamese marks removed and lowercased, so "đã chuyển khoản" and "da chuyen khoan" are the
 * same. Each pattern only covers statements, never questions about a topic ("chính sách hoàn tiền thế nào"): a missed
 * turn still reaches Jev, while a false hit hands a sales chat to people. `unless` drops a hit on conditional or
 * questioning wording ("nếu em đã chuyển khoản", "em đã thanh toán chưa").
 */
const RULES: ReadonlyArray<{ category: HandoffCategory; re: RegExp; unless?: RegExp }> = [
  { category: 'payment_done', re: /\b(da|vua|moi) (chuyen khoan|ck|thanh toan|chuyen tien|dong tien|nop tien)\b/, unless: /\b(neu|chua)\b/ },
  { category: 'payment_done', re: /\b(chuyen khoan|ck|chuyen tien) (roi|xong)\b/, unless: /\b(neu|chua)\b/ },
  { category: 'payment_done', re: /\b(gui|anh|chup|day la) (bill|bien lai|uy nhiem chi)\b/ },
  { category: 'wants_human', re: /\b(gap|noi chuyen voi|ket noi voi) (nguoi that|nhan vien|tu van vien|nguoi tu van|quan ly|admin)\b/ },
  { category: 'complaint', re: /\bkhieu nai\b/ },
  { category: 'complaint', re: /\b(muon|can|yeu cau|doi|de nghi) (hoan (lai )?tien|tra lai tien)\b/ },
  { category: 'access_problem', re: /\bkhong (vao|dang nhap|truy cap|mo) (duoc|dc)\b/ },
  { category: 'access_problem', re: /\bloi dang nhap\b/ },
];

/** Lowercase text without Vietnamese marks; `đ` becomes `d`. */
export function foldVietnamese(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();
}

export function matchHandoffRule(text: string): HandoffCategory | null {
  const folded = foldVietnamese(text);
  return RULES.find((rule) => rule.re.test(folded) && !rule.unless?.test(folded))?.category ?? null;
}

/**
 * Replaces emails, phone numbers and other long digit runs (accounts, codes) before text leaves the CRM. Full-width
 * digits are folded first, and digits may be split by spaces, dots, commas, dashes, underscores or slashes.
 */
export function maskPersonalData(text: string): string {
  return text.normalize('NFKC')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/(?<![\d+])(\+?84|0)([\s.,_/-]?\d){8,10}(?!\d)/g, '[phone]')
    .replace(/\d[\d\s.,_/-]{4,}\d/g, (run) => (run.replace(/\D/g, '').length >= 6 ? '[number]' : run));
}

/** Longest customer text sent to Jev; a long burst keeps its latest lines. */
export const JEV_TEXT_MAX = 2000;

export interface JevAnswer { choice: string; confidence: number }
export type JevResult = { ok: true; answer: JevAnswer } | { ok: false; error: string };

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
/** Thresholds are tuned against one model version, so the version is pinned, never `jev-latest`. */
export const JEV_MODEL_DEFAULT = 'jev-1.13.0';
export const JEV_CONFIDENCE_DEFAULT = 0.75;
export const JEV_TIMEOUT_MS = 1500;
const BREAKER_ERRORS = 5;
const BREAKER_OPEN_MS = 30_000;

/** Per-isolate breaker: after 5 consecutive failures Jev is skipped for 30 seconds. Bad credentials never trip it. */
const breaker = { failures: 0, openUntil: 0 };
export function resetJevBreaker() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}

type JevEnv = Pick<Env, 'TYPESAFE_API_KEY' | 'JEV_MODEL'>;

/** Asks Jev which handoff category the customer's turn belongs to. Never throws. */
export async function classifyWithJev(env: JevEnv, text: string, now = Date.now()): Promise<JevResult> {
  if (!env.TYPESAFE_API_KEY) return { ok: false, error: 'no_key' };
  if (breaker.openUntil > now) return { ok: false, error: 'breaker_open' };
  const criteria: Record<string, string> = { [NONE]: NONE_CRITERIA };
  for (const [key, value] of Object.entries(HANDOFF_CATEGORIES)) criteria[key] = value.criteria;
  const fail = (error: string, trip = true): JevResult => {
    if (trip && ++breaker.failures >= BREAKER_ERRORS) {
      breaker.openUntil = now + BREAKER_OPEN_MS;
      breaker.failures = 0;
    }
    return { ok: false, error };
  };
  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.JEV_MODEL || JEV_MODEL_DEFAULT,
        state: `Tin nhắn khách gửi chatbot tư vấn khoá học của ABM (tiếng Việt):\n${maskPersonalData(text.slice(-JEV_TEXT_MAX))}`,
        questions: {
          handoff: { type: 'choice', instructions: 'Which kind of message is this? Pick the one that fits best.', criteria },
        },
      }),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) return fail(`misconfigured_${res.status}`, false);
    if (!res.ok) return fail(`http_${res.status}`);
    const body = await res.json() as { answers?: { handoff?: { choice?: unknown; confidence?: unknown } } };
    const answer = body.answers?.handoff;
    if (typeof answer?.choice !== 'string' || typeof answer.confidence !== 'number') return fail('bad_response');
    breaker.failures = 0;
    return { ok: true, answer: { choice: answer.choice, confidence: answer.confidence } };
  } catch (error) {
    return fail(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network');
  }
}

export function decisionMode(value: string | undefined): DecisionMode {
  return value === 'shadow' || value === 'active' ? value : 'off';
}

export interface HandoffDecision {
  /** The rule category that matched, if any. */
  rule: HandoffCategory | null;
  /** Jev's answer or why there is none; absent when Jev was not asked. */
  jev?: { choice: string; confidence: number } | { error: string };
  /** What the layer decided and which part decided it. Null means no person is needed. */
  decided: { layer: 'rule' | 'jev'; category: HandoffCategory } | null;
}

type DecisionEnv = JevEnv & Pick<Env, 'JEV_INTENT_MODE' | 'JEV_CONFIDENCE'>;

/** The handoff category Jev's answer stands for at this threshold, or null for `none`, an unknown label or low confidence. */
export function jevCategory(answer: JevAnswer, threshold: number): HandoffCategory | null {
  return Object.hasOwn(HANDOFF_CATEGORIES, answer.choice) && answer.confidence >= threshold ? answer.choice as HandoffCategory : null;
}

/**
 * Decides whether a customer turn needs a person: a rule hit decides at once; otherwise Jev's answer counts in
 * `active` mode when its confidence reaches the threshold. In `shadow` mode Jev is asked and logged only.
 * `askJev: false` skips Jev when its answer could not change anything.
 */
export async function decideHandoff(env: DecisionEnv, customerText: string, askJev = true): Promise<HandoffDecision> {
  const rule = matchHandoffRule(customerText);
  if (rule) return { rule, decided: { layer: 'rule', category: rule } };
  const mode = decisionMode(env.JEV_INTENT_MODE);
  if (mode === 'off' || !askJev) return { rule: null, decided: null };
  const result = await classifyWithJev(env, customerText);
  if (!result.ok) return { rule: null, jev: { error: result.error }, decided: null };
  const category = mode === 'active' ? jevCategory(result.answer, Number(env.JEV_CONFIDENCE) || JEV_CONFIDENCE_DEFAULT) : null;
  return { rule: null, jev: result.answer, decided: category ? { layer: 'jev', category } : null };
}
