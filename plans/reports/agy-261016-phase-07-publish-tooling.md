# Phase 07 Report — Publish and Video-Upload Tooling

## Files Created / Modified
- Created: `apps/crm/scripts/lms-html.mjs` (`parseHandbook`, `injectBridge`, `BRIDGE_SCRIPT`)
- Created: `apps/crm/scripts/lms-html.test.mjs` (`node:test` unit + BSR handbook verification)
- Created: `apps/crm/scripts/lms-publish.mjs` (CLI for `--list-classes`, `--dry-run`, and publishing handbook HTML + lessons)
- Created: `apps/crm/scripts/lms-upload-video.mjs` (CLI for tus 50 MiB chunked upload to Cloudflare Stream with `requiresignedurls` and CRM video attachment)
- Created: `apps/crm/scripts/issue-lms-publish-token.mjs` (CLI for issuing `label = 'lms-publish'` agent token without revoking GoClaw tokens)
- Created: `docs/guides/lms-publish-handbook.md` (Vietnamese operational guide, 102 lines)
- Modified: `docs/README.md` (added guide link under `Tài liệu hiện có`)

## Verification Results

1. **Task 7.3 — Script syntax checks** (cwd `D:\TQD\CRM\apps\crm`):
   - `node --check scripts/lms-publish.mjs` → exit 0
   - `node --check scripts/lms-upload-video.mjs` → exit 0
   - `node --check scripts/issue-lms-publish-token.mjs` → exit 0

2. **Task 7.4 — Parser & bridge unit tests (`node:test`)** (cwd `D:\TQD\CRM\apps\crm`):
   - `node --test scripts/lms-html.test.mjs` → exit 0 (`# tests 3`, `# pass 3`, `# fail 0`, `# skipped 0`)

3. **Task 7.5 — `--dry-run` output on BSR handbook** (titles only):
```text
Tiêu đề: BSR × ABM — Cẩm Nang A.I Toàn Diện Cho CBNV BSR
Số phần: 26
b1p1 — Buổi 1 — Phần 1 — Khơi mở "Năng lượng mới"
b1p2 — Buổi 1 — Phần 2 — Bản đồ 06 trợ lý số
b1p3 — Buổi 1 — Phần 3 — Kỷ luật sắt: bảo mật thông tin
b1p4 — Buổi 1 — Phần 4 — Thao trường tình huống
b2m1 — Buổi 2 — Module 01 — Bản chất của Prompt
b2m2 — Buổi 2 — Module 02 — Cấu trúc 06 thành phần
b2m3 — Buổi 2 — Module 03 — Dữ liệu nguồn & ví dụ mẫu
b2m4 — Buổi 2 — Module 04 — A.I phỏng vấn ngược
b2m5 — Buổi 2 — Module 05 — Tự kiểm, phản biện, cải tiến
b2m6 — Buổi 2 — Module 06 — Các lỗi thường gặp
b2m7 — Buổi 2 — Module 07 — Prompt cho việc thật tại đơn vị
b3data — Buổi 3 — Bộ tài liệu giả lập thực hành
b3m1 — Buổi 3 — Module 01 — Nhận diện việc ngốn thời gian
b3m2 — Buổi 3 — Module 02 — A.I làm gì, con người giữ gì
b3m3 — Buổi 3 — Module 03 — Đúng nguồn, đúng năng lực A.I
b3m4 — Buổi 3 — Module 04 — Quy trình Người – A.I – Người duyệt
b3m5 — Buổi 3 — Module 05 — Kiểm chéo, phản biện, trách nhiệm
b3m6 — Buổi 3 — Module 06 — Cải tiến quy trình cá nhân
b3m7 — Buổi 3 — Module 07 — Quick Win đầu – cuối
lib1 — Thư viện — Khối 01 — Kỹ thuật · Vận hành · Bảo dưỡng · HSE
lib2 — Thư viện — Khối 02 — Văn phòng · Kế hoạch · Tài chính · Pháp chế
lib3 — Thư viện — Khối 03 — Nhân sự · Đào tạo · Truyền thông · Thương mại
security — - — Mã màu an toàn Xanh–Vàng–Đỏ
tools — - — Chọn công cụ & Link truy cập
checklist — - — Checklist & Cam kết hành động
quiz — - — Bài ôn tập 15 câu
```

Status: DONE
