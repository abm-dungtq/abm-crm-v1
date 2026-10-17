---
title: "Cổng học LMS cho học viên ABM (chung CSDL với CRM)"
description: "Học viên đăng nhập trang học riêng bằng tài khoản CRM cấp, xem chương trình của lớp mình theo từng phần kèm video Stream; Học vụ quản lý tài khoản, quyền, video và nhập nhân viên doanh nghiệp vào lớp."
status: in-progress
priority: P2
effort: 8d
branch: main
tags: [feature, backend, frontend, database, auth]
blockedBy: []
blocks: []
created: 2026-10-16
---

# Cổng học LMS cho học viên ABM

Status: pending · Owner: Opus (giám sát, chạy mọi việc remote) · Executor: Agy `gemini-4-argon-high` (phase 01–07) · Chế độ: `--advice` (mỗi phase có Failure Protocol)

## Mục tiêu
Học viên đăng nhập trang học riêng (`abm-lms`) bằng email + mật khẩu mặc định chung của tổ chức (nhắc đổi, không bắt buộc). Trang chủ liệt kê chương trình của các lớp họ được ghi danh; mở chương trình thấy từng phần của cẩm nang HTML và ô "Video bài học" của từng phần (Cloudflare Stream, link ký có hạn). Trong CRM, Học vụ/Admin cấp tài khoản, đặt lại mật khẩu, cấp tay/chặn quyền, gắn video, đặt số ngày xem lại, nhân bản chương trình sang lớp mới và nhập danh sách nhân viên doanh nghiệp vào lớp. Claude Code trên máy đăng cẩm nang qua API có khóa.

Hợp đồng gốc: `plans/reports/brainstorm-261016-1503-lms-learner-portal.md` (vòng 1, 2 và câu trả lời 15:57). Demo giao diện: `plans/reports/brainstorm-261016-1538-lms-class-program-demo.html`.

## Quyết định đã chốt (không đổi khi làm)
- Worker riêng `abm-lms` + Worker nội dung `abm-lms-content`, dùng chung D1 `abm-crm-eval`. **Chỉ `apps/crm/migrations` sở hữu schema**; app LMS không có thư mục migrations.
- 1 lớp ↔ 1 chương trình (`lms_program.class_id` UNIQUE, cho phép NULL).
- Quyền xem = ghi danh `confirmed/studying/completed` ∪ cấp tay (`lms_access.mode='grant'`), trừ chặn (`mode='block'`). Hết hạn xem lại = buổi học cuối không huỷ + `lms_program.review_days` ngày (NULL = không giới hạn); cấp tay còn hạn thắng hết hạn.
- Mật khẩu mặc định chung lưu một bản băm ở `org_setting`; `learner_account.password_hash IS NULL` = đang dùng mật khẩu mặc định. Đặt lại = về NULL. Không băm từng người khi nhập.
- Nhập nhân viên doanh nghiệp (vẫn do Sale/Leader/Admin làm ở trang Đối tác như hiện nay): mở rộng `importContractLearners` với `classId` tuỳ chọn → lead `partner` won + enrollment `confirmed` + consent `enrollment` + tài khoản (nếu có email). Trùng tài khoản thì chỉ thêm lớp, không đụng mật khẩu.
- Nhân bản chương trình không chép video. Lead `partner` bị loại khỏi số "chốt" trong báo cáo Sale.
- Video: Cloudflare Stream `requireSignedURLs`; LMS Worker tự ký token RS256.
- Nội dung HTML chạy ở origin riêng không cookie, link HMAC hạn 2 giờ, CSP `connect-src 'none'`, iframe sandbox.
- Đăng bài bằng token agent (`agent_token`, cơ chế MCP sẵn có) của một user Học vụ/Admin.

## Phase
| # | Phase | Executor | Phụ thuộc | Trạng thái |
|---|-------|----------|-----------|------------|
| 01 | [Schema, package dùng chung, contracts](phase-01-schema-shared-package.md) | Agy | — | completed |
| 02 | [CRM: tài khoản học viên và quyền xem](phase-02-crm-learner-accounts-access.md) | Agy | 01 | completed |
| 03 | [CRM: chương trình, video, nhân bản, API đăng bài](phase-03-crm-programs-videos-publish.md) | Agy | 02 | completed |
| 04 | [CRM: nhập nhân viên vào lớp + lọc báo cáo Sale](phase-04-crm-b2b-import-reports.md) | Agy | 02, 03 | completed |
| 05 | [CRM web: màn hình Học vụ](phase-05-crm-web-ui.md) | Agy | 02, 03, 04 | completed |
| 06 | [App `apps/lms`: trang học + Worker nội dung](phase-06-lms-app.md) | Agy | 01, 02, 03 | completed |
| 07 | [Công cụ đăng bài và tải video cho agent](phase-07-publish-tooling.md) | Agy | 03, 06 | completed |
| 08 | [Phát hành: sao lưu, migration remote, secrets, deploy, thử với cẩm nang BSR](phase-08-release.md) | Opus | 01–07 | pending |

Các phase chạy tuần tự 01 → 08: phase 02–05 cùng sửa `commands.ts`, `index.ts` và `packages/contracts`, nên không chạy song song.

## Tiêu chí nghiệm thu
1. Học viên có ghi danh lớp đã có chương trình thì đăng nhập thấy chương trình; người không có quyền mở link trực tiếp bị từ chối (trang, HTML, token video).
2. Đăng nhập bằng mật khẩu mặc định chạy được, có banner nhắc đổi; đổi xong đăng nhập bằng mật khẩu mới.
3. Học vụ đặt lại mật khẩu, cấp/chặn quyền, đặt số ngày xem lại, thêm/sửa/xoá video từng phần, nhân bản chương trình trên CRM.
4. Nhập file 200 nhân viên vào lớp: xem trước đúng số tạo mới / đã có tài khoản / thiếu email / lỗi; xác nhận xong mỗi người có ghi danh và (nếu có email) tài khoản.
5. Đăng cẩm nang BSR bằng script: đủ 26 phần theo `section id` (27 section trừ trang chủ `home`), hiển thị trong iframe; video Stream phát được.
6. Script trong cẩm nang không đọc được cookie trang học và không gọi mạng ra ngoài (test CSP + kiểm thử tay).
7. Hết hạn xem lại thì thẻ chương trình hiện "Đã hết hạn xem lại" và nội dung/video bị từ chối.
8. Số "chốt" trong báo cáo Sale không đếm lead nguồn `partner`.
9. `pnpm -r typecheck` và `pnpm -r test` exit 0.

## Quy tắc cho executor (lặp lại trong từng phase)
- Không `git commit`, không deploy, không `wrangler --remote`, không chạy dev server nền.
- Chỉ sửa file được liệt kê trong phase. Báo cáo cuối phase ở `plans/reports/` kết thúc bằng dòng `Status:`.
- Mỗi Verify thất bại → Failure Protocol (dừng, gọi kongming hoặc báo user).

## Rủi ro chính
- Hai Worker cùng ghi D1: chỉ CRM chạy migration; LMS chỉ ghi `learner_session`, `lms_progress`, cột đăng nhập của `learner_account`.
- CPU gói miễn phí: chỉ băm mật khẩu khi đăng nhập/đổi/đặt mật khẩu mặc định; nhập 200 dòng không băm.
- Stream là dịch vụ trả phí; cần bật gói và tạo signing key trước phase 08.
- Mật khẩu chung không bắt đổi (user chấp nhận): khóa 5 phút sau 10 lần sai, lọc "chưa đổi mật khẩu" cho Học vụ.

## Red Team Review (kongming, 16/10 16:20) — GO-with-fixes, đã áp dụng
- `packages/lms-core` cần `lib: ["ES2022","DOM"]` để có `crypto.subtle`/`atob`.
- Lọc lead `partner` ở đúng câu rollup của `dashboard` (`queries.ts` ~241), không sửa các dòng đọc rollup.
- Script cấp token đăng bài không thu hồi token GoClaw của user.
- Route đăng bài chép `commit()` từ `admin-routes.ts` và tôn trọng công tắc tắt agent.
- Iframe sandbox không có `allow-same-origin`, nên `postMessage` dùng `'*'` và kiểm `event.source`; thêm `allow="clipboard-write"` cho nút sao chép của cẩm nang.
- CSP của trang học nằm ở `public/_headers` (HTML do Assets phục vụ); build trước khi test app LMS.
- App LMS tự chèn dữ liệu test, không import seed của CRM.
- Khoá tài khoản trả 401 như CRM (không lộ trạng thái khoá).
- Nhập 200 dòng vào lớp: đo; nếu quá tải thì giới hạn 100.
- Giới hạn chấp nhận: link nội dung/video ký có hạn 2 giờ, không gắn với từng học viên; token agent của Học vụ/Admin nào cũng đăng bài được.

## Validation Log (16/10) — mặc định đang dùng, chờ user xác nhận trước khi chạy phase liên quan
1. Ai nhập nhân viên doanh nghiệp vào lớp: Sale/Leader/Admin ở trang Đối tác (như hiện nay). Nếu muốn Học vụ làm → sửa phase 04 (`resolveOwner`, quyền đọc đối tác) và phase 05.
2. Cloudflare Stream: user tự bật gói trả phí ở phase 08 (Task 8.2). Chưa bật thì phase 01–07 vẫn làm được; chỉ phần phát video live phải chờ.
3. Phiên đăng nhập học viên: 30 ngày (cookie `abm_learner`, phase 06).
4. Ban giám đốc (director): chỉ xem màn hình Học vụ, không sửa (phase 02/05).

## Tiến độ (16/10 18:12)
- Phase 01–07 xong (Agy làm, Opus soát, kongming duyệt sau mỗi phase). Typecheck, build CRM + LMS, toàn bộ test: lms-core 12, lms 17, crm 597, zalo-bridge 114, poc 16 — 0 lỗi. Cẩm nang BSR tách đúng 26 phần.
- Phase 08 chờ user: bật Stream, tạo token/account id, đồng ý sao lưu + migration remote + deploy.
