export class UnsafeRecoveryReplyError extends Error {}

const REGISTRATION_GROUP_LINE = /^\s*-?\s*Link nhóm Zalo chính xác:\s*(https:\/\/zalo\.me\/g\/[^\s<>"'“”]+)/gimu;

/**
 * The registration group link changes with each program, so it is read from the trusted channel
 * override line "Link nhóm Zalo chính xác: …" instead of being fixed in code. The last such line
 * wins because the channel override comes after the shared instructions.
 */
export function registrationGroupUrl(trustedInstructions: string): string | null {
  const links = [...trustedInstructions.matchAll(REGISTRATION_GROUP_LINE)].flatMap((match) => {
    const url = match[1];
    return url ? [url.replace(/[.,!?;:]+$/u, '')] : [];
  });
  return links.at(-1) ?? null;
}

function normalizeReply(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');
}
const registrationSuccessPattern = /\b(?:da\s+)?dang ky\b[^.!?;,\n]{0,100}?\bthanh cong\b/gu;

function hasAffirmativeRegistrationSuccess(normalized: string): boolean {
  for (const match of normalized.matchAll(registrationSuccessPattern)) {
    const index = match.index;
    const matched = match[0];
    if (index === undefined || matched === undefined) continue;
    const before = normalized.slice(Math.max(0, index - 120), index);
    const clausePrefix = before.split(/[.!?;,\n]/u).at(-1) ?? before;
    const after = normalized.slice(index + matched.length);
    const clauseAfter = after.split(/[.!?;,\n]/u)[0] ?? after;
    const predicateSuffix = clauseAfter.split(
      /\b(?:va|nhung|dong thoi|sau do|con)\s+(?=(?:neu|khi|de|em|anh|chi|ban|can|muon|xin)\b)/u,
    )[0] ?? clauseAfter;
    const uncertain = /\b(?:chua|chang|khong)\s+(?:(?:the|duoc)\s+)?(?:(?:xac nhan|ket luan|xem|coi)\s+(?:la\s+)?)?(?:(?:thuc su|hoan toan)\s+)?thanh cong\b/u.test(matched)
      || /\b(?:se|co the)\s+(?:duoc\s+)?(?:(?:xac nhan|xem|coi|xu ly|hoan tat)\s+(?:la\s+)?)?(?:(?:som|nhanh chong|chac chan)\s+)?thanh cong\b/u.test(matched)
      || /\b(?:neu|truoc khi|cho den khi)\b[^.!?;,\n]{0,80}\bthanh cong\b/u.test(matched)
      || /\b(?:chua|khong|chang)\s+(?:the\s+)?(?:xac nhan|ket luan|doi soat|chung minh|khang dinh)(?:\s+duoc)?(?:\s+(?:rang|lieu|viec|la))?(?:\s+(?:anh\s*\/?\s*chi|ban|khach hang))?\s*$/u.test(clausePrefix)
      || /\b(?:chua|khong|chang)\s+(?:(?:the|duoc)\s+)?$/u.test(clausePrefix)
      || /\b(?:se|de)\s+(?:(?:em|toi|ben em|chung toi|anh\s*\/?\s*chi|ban|khach hang)\s+)?(?:duoc\s+)?(?:(?:ho tro|giup)\s+)?(?:xac nhan\s+)?$/u.test(clausePrefix)
      || /\b(?:neu|truoc khi|cho den khi)\b[^.!?;,]{0,100}$/u.test(clausePrefix)
      || /\b(?:khi|sau khi)\s+(?:(?:anh\s*\/?\s*chi|ban|khach hang)\s+)?$/u.test(clausePrefix)
      || /\b(?:co the|mong|chuc)\s+(?:(?:em|toi|ben em|chung toi|anh\s*\/?\s*chi|ban)\s+)?(?:duoc\s+)?(?:(?:ho tro|giup|xac nhan)\s+)?$/u.test(clausePrefix)
      || /\b(?:khong biet|chua ro|can kiem tra)(?:\s+(?:lieu|la))?(?:\s+(?:anh\s*\/?\s*chi|ban))?\s*$/u.test(clausePrefix)
      || /\b(?:neu|khi|sau khi|truoc khi|cho den khi|voi dieu kien)\b/u.test(predicateSuffix)
      || /^\s*(?:hay chua|hay khong|dung khong|phai khong|duoc khong|khong|chua|chu)\b/u.test(predicateSuffix)
      || /\b(?:roi\s+)?(?:dung khong|phai khong|duoc khong|hay chua|hay khong)\s*$/u.test(predicateSuffix);
    if (!uncertain) return true;
  }
  return false;
}

function zaloGroupLinks(text: string): string[] {
  return text.match(/https:\/\/zalo\.me\/g\/[^\s<>"'“”]+/giu)
    ?.map(link => link.replace(/[.,!?;:]+$/u, '')) ?? [];
}

/** Reply text plus whether the model also asked to hand the conversation to a person. */
export interface RegistrationPolicyOutput {
  reply: string;
  handoff: boolean;
}

/** Enforces the owner-approved program name/link shape; input qualification remains model-driven. */
export function assertRegistrationPolicyOutput(
  output: RegistrationPolicyOutput,
  policyEnabled: boolean,
  trustedInstructions = '',
): boolean {
  const normalized = normalizeReply(output.reply);
  const registrationSuccess = hasAffirmativeRegistrationSuccess(normalized);
  const namedProgram = normalized.includes('xay dung bo nao thu hai')
    && normalized.includes('doi quan tro ly ai ca nhan hoa');
  const mentionsTargetProgram = normalized.includes('bo nao thu hai')
    || normalized.includes('doi quan tro ly ai');
  const groupLinks = zaloGroupLinks(output.reply);
  const groupUrl = registrationGroupUrl(trustedInstructions);
  const configuredGroups = new Set(zaloGroupLinks(trustedInstructions));
  const hasConfiguredAlternateGroup = groupLinks.length > 0
    && groupLinks.every(link => link !== groupUrl && configuredGroups.has(link));
  const concernsThisPolicy = (groupUrl !== null && groupLinks.includes(groupUrl))
    || (registrationSuccess && mentionsTargetProgram)
    || (policyEnabled && registrationSuccess && !hasConfiguredAlternateGroup);
  if (!concernsThisPolicy) return false;
  if (!policyEnabled) {
    throw new UnsafeRecoveryReplyError('Chính sách xác nhận đăng ký Zalo không còn hiệu lực. Chưa gửi tin.');
  }
  if (!registrationSuccess || !namedProgram || groupUrl === null || groupLinks.length !== 1 || groupLinks[0] !== groupUrl) {
    throw new UnsafeRecoveryReplyError('Xác nhận đăng ký phải có đúng tên chương trình và link nhóm Zalo được cấu hình. Chưa gửi tin.');
  }
  if (output.handoff) {
    throw new UnsafeRecoveryReplyError('Không được vừa xác nhận đăng ký vừa chuyển người thật. Chưa gửi tin.');
  }
  return true;
}
