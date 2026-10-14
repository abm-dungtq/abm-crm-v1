import { expect, test } from 'vitest';
import {
  UnsafeRecoveryReplyError, assertRegistrationPolicyOutput, registrationGroupUrl,
} from '../src/worker/inbox/zalo-oa-registration-guard';

const REGISTRATION_GROUP_URL = 'https://zalo.me/g/5fsvz1vdhrewdka7uxuk';
const trusted = `- Link nhóm Zalo chính xác: ${REGISTRATION_GROUP_URL}`;

/** The live guard reads the group link from trusted instructions, so that line is the default here. */
const check = (reply: string, enabled: boolean, instructions = trusted, handoff = false) =>
  assertRegistrationPolicyOutput({ reply, handoff }, enabled, instructions);

test('authorized registration output requires the named program and exact group link', () => {
  expect(registrationGroupUrl(trusted)).toBe(REGISTRATION_GROUP_URL);
  const valid = {
    reply: `Anh/chị đã đăng ký thành công chương trình Xây dựng Bộ não thứ hai & Đội quân Trợ lý AI cá nhân hóa. ${REGISTRATION_GROUP_URL}`,
  };
  expect(check(valid.reply, true)).toBe(true);
  expect(() => check(valid.reply, false)).toThrow(UnsafeRecoveryReplyError);
  expect(() => check(valid.reply, true, '')).toThrow(UnsafeRecoveryReplyError);
  expect(check(`${valid.reply} Và nếu cần hỗ trợ thêm, anh/chị cứ nhắn em ạ.`, true)).toBe(true);
  for (const reply of [
    'Anh/chị đã đăng ký thành công chương trình Xây dựng Bộ não thứ hai & Đội quân Trợ lý AI cá nhân hóa.',
    'Anh/chị đã đăng ký thành công chương trình Xây dựng Bộ não thứ hai & Đội quân Trợ lý AI cá nhân hóa. https://zalo.me/g/wrong',
    'Anh/chị đã đăng ký thành công chương trình Xây dựng Bộ não thứ hai.',
    `Mời anh/chị vào nhóm ${REGISTRATION_GROUP_URL}`,
    `Anh/chị đăng ký thành công nếu chuyển đủ 199k. Chương trình Xây dựng Bộ não thứ hai & Đội quân Trợ lý AI cá nhân hóa: ${REGISTRATION_GROUP_URL}`,
    `Anh/chị đã đăng ký thành công chương trình Xây dựng Bộ não thứ hai & Đội quân Trợ lý AI cá nhân hóa đúng không? ${REGISTRATION_GROUP_URL}`,
    `Anh/chị đã đăng ký thành công chương trình Xây dựng Bộ não thứ hai & Đội quân Trợ lý AI cá nhân hóa rồi phải không? ${REGISTRATION_GROUP_URL}`,
    'Anh/chị đã đăng ký thành công và nếu cần hỗ trợ hãy nhắn em.',
    'Anh/chị đã đăng ký thành công chương trình Xây dựng Bộ não thứ hai & Đội quân Trợ lý AI cá nhân hóa và nếu cần hỗ trợ hãy nhắn em.',
  ]) expect(() => check(reply, true)).toThrow(UnsafeRecoveryReplyError);
  for (const reply of [
    'Anh/chị đã đăng ký thành công chương trình.',
    'Dạ em xác nhận đăng ký thành công chương trình.',
    'Anh/chị đã đăng ký khóa học thành công.',
    'Anh/chị đã đăng ký thành công chương trình. https://zalo.me/g/wrong',
    'Sau khi xem biên lai anh/chị đã đăng ký thành công chương trình.',
    'Khi em kiểm tra thấy anh/chị đã đăng ký thành công chương trình.',
    'Việc đăng ký không chỉ thành công mà còn hoàn tất sớm.',
    'Việc đăng ký không gặp lỗi và đã thành công.',
    'Việc đăng ký không những thành công mà còn hoàn tất sớm.',
    'Việc đăng ký sau khi kiểm tra đã thành công.',
  ]) expect(() => check(reply, true)).toThrow(UnsafeRecoveryReplyError);
  expect(check('Dạ em xác nhận đăng ký thành công chương trình.', false)).toBe(false);
  for (const reply of [
    'Dạ hiện em chưa thể xác nhận đăng ký thành công chương trình Xây dựng Bộ não thứ hai ngay được ạ.',
    'Khi giao dịch hoàn tất, em sẽ xác nhận đăng ký thành công cho anh/chị.',
    'Anh/chị đã đăng ký thành công hay chưa ạ?',
    'Sau khi chuyển tiền anh/chị sẽ được đăng ký thành công.',
    'Khi anh/chị đăng ký thành công, em sẽ gửi link nhóm.',
    'Đăng ký chưa thành công ạ.',
    'Việc đăng ký chưa được xác nhận là thành công.',
    'Chưa thể xác nhận đã hoàn tất đăng ký chương trình. Khi nào ngân hàng báo giao dịch thành công, em sẽ hỗ trợ tiếp.',
  ]) {
    expect(check(reply, true)).toBe(false);
    expect(check(reply, false)).toBe(false);
  }
  const unrelated = 'Thông tin nhóm chương trình khác: https://zalo.me/g/other-program';
  expect(check(unrelated, true)).toBe(false);
  expect(check(unrelated, false)).toBe(false);
  const alternate = 'Anh/chị đã đăng ký thành công khóa IELTS. https://zalo.me/g/ielts-group';
  expect(() => check(alternate, true)).toThrow(UnsafeRecoveryReplyError);
  expect(check(alternate, true, 'Nhóm khóa IELTS: https://zalo.me/g/ielts-group')).toBe(false);
  expect(check(alternate, false)).toBe(false);
  for (const reply of [
    'Anh/chị đã đăng ký khóa IELTS thành công.',
    'Anh/chị đã đăng ký khóa học IELTS thành công.',
    'Anh/chị đã đăng ký lớp IELTS thành công.',
  ]) {
    expect(() => check(reply, true)).toThrow(UnsafeRecoveryReplyError);
    expect(check(reply, false)).toBe(false);
  }
  expect(() => check(valid.reply, true, trusted, true)).toThrow(UnsafeRecoveryReplyError);
});
