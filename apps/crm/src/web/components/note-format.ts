import { INTAKE_FIELDS, type IntakeField, type IntakePipeline, type LeadIntake } from '../types';

/** Same limit as needSummary in createLeadInput / createLearnerLeadInput. */
export const NEED_MAX = 1000;
/** Maximum length of the AI/staff conversation summary saved to the lead note. */
export const SUMMARY_MAX = 1500;
export const SUMMARY_NEAR_LIMIT = 1200;

export const ACTIVITY_MAX_LINES = 6;
export const ACTIVITY_MAX_CHARS = 600;

export const INTAKE_FIELD_LABEL: Record<IntakeField, string> = {
  name: 'Tên',
  phone: 'SĐT',
  email: 'Email',
  program: 'Chương trình',
  need: 'Nhu cầu',
  interest: 'Quan tâm',
  note: 'Ghi chú',
  summary: 'Tóm tắt hội thoại',
};

export const ROW_INTAKE_FIELDS = INTAKE_FIELDS.filter(
  (f): f is Exclude<IntakeField, 'summary'> => f !== 'summary',
);

/** Splits a "- " multi-line conversation summary into clean bullet lines. */
export function summaryBullets(summary: string | undefined): string[] {
  if (!summary) return [];
  return summary
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-•*]\s+/, '').trim())
    .filter(Boolean);
}

export interface ClassifyForm {
  contactName: string;
  phone: string;
  email: string;
  companyName: string;
  taxCode: string;
  needSummary: string;
  summary: string;
  sourceNote: string;
  ownerUserId: string;
  productId: string;
  courseId: string;
}

/** Form values from the intake: name, phone, email, pre-matched productId, summary, and need/program/interest/note as the need summary. */
export function prefillClassifyForm(intake: LeadIntake, fallbackName: string | null): ClassifyForm {
  const f = intake.fields;
  const need = [
    f.need,
    f.program && `Chương trình quan tâm: ${f.program}`,
    f.interest && `Quan tâm: ${f.interest}`,
    f.note && `Ghi chú: ${f.note}`,
  ].filter(Boolean).join('\n');
  return {
    contactName: f.name ?? fallbackName?.trim() ?? '',
    phone: f.phone ?? '',
    email: f.email ?? '',
    companyName: '',
    taxCode: '',
    needSummary: (need || f.program || '').slice(0, NEED_MAX),
    summary: (f.summary ?? '').slice(0, SUMMARY_MAX),
    sourceNote: '',
    ownerUserId: '',
    productId: f.productId ?? '',
    courseId: '',
  };
}

/** Builds the POST /inbox/intakes/:id/classify payload, sending `summary` only when non-empty after trim. */
export function buildClassifyPayload(
  pipeline: IntakePipeline,
  input: Record<string, unknown>,
  summary?: string,
): { pipeline: IntakePipeline; input: Record<string, unknown>; summary?: string } {
  const trimmed = summary?.trim();
  return {
    pipeline,
    input,
    ...(trimmed ? { summary: trimmed } : {}),
  };
}

/** Clamps an activity note when it exceeds 6 lines or 600 characters so long transcripts stay compact. */
export function clampActivityText(text: string): { clamped: boolean; preview: string } {
  const lines = text.split(/\r?\n/);
  const overLines = lines.length > ACTIVITY_MAX_LINES;
  const overChars = text.length > ACTIVITY_MAX_CHARS;
  if (!overLines && !overChars) {
    return { clamped: false, preview: text };
  }
  let sliced = overLines ? lines.slice(0, ACTIVITY_MAX_LINES).join('\n') : text;
  if (sliced.length > ACTIVITY_MAX_CHARS) {
    const cut = sliced.slice(0, ACTIVITY_MAX_CHARS);
    const lastSpace = cut.lastIndexOf(' ');
    sliced = (lastSpace > ACTIVITY_MAX_CHARS * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd();
  } else {
    sliced = sliced.trimEnd();
  }
  return { clamped: true, preview: `${sliced}…` };
}
