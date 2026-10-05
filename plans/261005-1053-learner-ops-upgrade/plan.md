---
title: "CRM: thêm luồng học viên cá nhân (tuyển sinh, tổ chức, điểm danh, học phí)"
description: "Thêm pipeline học viên, giữ khách 3 tháng, hành trình 8 bước, khóa/lớp/buổi, ghi danh, điểm danh, sổ học phí, hợp đồng đối tác và báo cáo theo PRD 'CRM bàn làm việc', chạy song song luồng B2B trên Cloudflare + bot Lark."
status: pending
priority: P1
effort: 12-13d
branch: main
tags: [feature, backend, frontend, database, auth, mcp]
blockedBy: []
blocks: []
created: 2026-10-05
---

# Nâng cấp CRM: luồng học viên cá nhân

- PRD: [prd-crm-ban-lam-viec-learner-ops-20261005.md](../../docs/source-package/sources/prd-crm-ban-lam-viec-learner-ops-20261005.md)
- Hợp đồng đã duyệt: [brainstorm-261005-1053-learner-ops-prd-upgrade.md](../reports/brainstorm-261005-1053-learner-ops-prd-upgrade.md)

Kế hoạch này viết cho executor chạy dưới `--advice`. Mỗi phase có một khối Failure Protocol riêng. Khi một bước Verify không đạt, executor phải dừng lại. Đó là hành vi đúng, không phải bị kẹt.

## Kết quả cần đạt

CRM eval có thêm luồng học viên chạy song song luồng B2B. Lead B2B cũ, các lệnh MCP hiện có và quyền Leader vẫn chạy như trước.

- **Tuyển sinh** (vai trò Sale, Leader):
  - Tạo khách và lead học viên.
  - Gắn sản phẩm cho khách.
  - Đi hành trình 8 bước cố định.
  - Giữ khách 3 tháng lịch. Hết hạn mà chưa thắng thì khách về hồ chung để sale khác nhận.
  - Quản lý hợp đồng đối tác và nhập học viên từ file vào một hợp đồng.
- **Tổ chức (quản lý học viên)** (vai trò mới `academic`):
  - Sửa danh mục sản phẩm.
  - Mở khóa, lớp và buổi học, gán giáo viên.
  - Xác nhận chỗ, bảo lưu, chuyển lớp.
- **Giáo viên** (vai trò mới `teacher`): điểm danh lớp của mình. Chỉ thấy tên học viên. Admin cũng được gán làm giáo viên của lớp.
- **Kế toán** (vai trò mới `accountant`):
  - Ghi khoản phải thu và ghi tiền vào.
  - Phân bổ tiền và xử lý hàng đợi tiền chưa khớp.
  - Xem nội dung chuyển khoản do server sinh.
  - Ghi số tham chiếu hóa đơn.
- **Admin** (chủ đơn vị):
  - Xem toàn bộ và đổi sale của khách.
  - Xem báo cáo theo PRD §11.
  - Xử lý yêu cầu về dữ liệu cá nhân.
- **Bot Lark** áp đúng quyền mới:
  - Sale khác không thấy số điện thoại của khách đang được người khác giữ.
  - Ba vai trò mới không có công cụ ghi qua bot.

## Quyết định đã chốt (không mở lại)

Do user chốt ngày 2026-10-05:

1. PRD được dùng để **bổ sung** luồng học viên. Pipeline B2B (QĐ1, QĐ4, QĐ13) giữ nguyên.
2. Vẫn dùng Cloudflare Workers, D1 và bot Lark. Bỏ mục 23 "chỉ chạy local" của PRD.
3. **Học phí ghi trong CRM** theo PRD §9. Với luồng học viên, cách này thay QĐ8, nên phải ghi ADR-007.
4. Giữ Leader và thêm 3 vai trò `academic`, `teacher`, `accountant`. Tuyển sinh ứng với `sale`/`leader`, chủ đơn vị ứng với `admin`. Mỗi người chỉ có một vai trò.
5. Luồng học viên giữ khách 3 tháng rồi đưa về hồ chung. Luồng B2B vẫn dùng hàng chờ và để Leader giao lead.
6. **Không** có người giám hộ và không lưu ngày sinh. Vẫn giữ đồng ý theo từng mục đích.
7. Nguồn lead dùng 8 nguồn của QĐ12. Nguồn `partner` bắt buộc gắn một hợp đồng đối tác đang hiệu lực. QĐ12 không có nguồn "Khác", nên quy tắc "nguồn Khác bắt buộc ghi chú" của PRD không áp dụng. Ô ghi chú nguồn không bắt buộc.
8. **Có** nhập học viên từ file CSV vào một hợp đồng đối tác.
9. Các mục khác trong phần "Chỗ còn trống" của PRD giữ đúng như PRD viết:
   - không gộp hồ sơ trùng;
   - không có hạn xử lý cho từng bước;
   - buổi học tạo từng buổi một;
   - chưa thu tiền vẫn được học;
   - gói buổi không bị trừ khi điểm danh;
   - và các mục còn lại.
10. Nhân sự cho các vai trò mới (user chốt 2026-10-05 11:27):
    - Vai trò `academic` hiển thị là **"Tổ chức (quản lý học viên)"**, do **Thanh Hằng** (`thanhhangle0197@gmail.com`) giữ. Hằng **rời Sale**, không còn thuộc nhóm KD1.
    - **Giáo viên** là **Trịnh Quang Dũng** và **Đặng Tú**. Cả hai vẫn giữ vai trò `admin` (mỗi người một vai trò). Admin được gán vào lớp như giáo viên và điểm danh được, nên không cần tài khoản `teacher` riêng.
    - **Kế toán** (`accountant`) là **Thanh** (`dangthanh420@gmail.com`).

## Mặc định thiết kế (planner chọn, chỉ đổi khi user yêu cầu)

- **Sở hữu khách:**
  - Sale giữ khách được lưu trên `contact` bằng ba cột `owner_user_id`, `hold_started_at`, `hold_expires_at`.
  - Hồ chung được tính ngay lúc đọc: `hold_expires_at <= now` và khách chưa có lead thắng. Không cần cron.
  - Khi nhận khách hoặc đổi sale, mọi lead học viên đang mở của khách cũng đổi owner theo.
- **Lead học viên:**
  - Dùng chung bảng `lead`, có thêm cột `pipeline`, nhận giá trị `b2b` hoặc `learner`.
  - Các stage của luồng học viên: `new`, `contacted`, `qualified`, `trial_booked`, `trial_done`, `won`, `lost`, `not_fit`.
  - Lead học viên luôn có owner, nên không bao giờ ở trạng thái `queue`.
  - Lead học viên vẫn giữ Forced Next Action (QĐ13), vì ràng buộc CHECK của bảng đòi điều đó.
  - SLA first-contact không áp cho lead học viên (PRD mục 12).
- **Quyền Leader trong luồng học viên:**
  - Leader đọc khách của nhóm mình, kể cả số điện thoại.
  - Leader đổi sale trong nhóm mình.
  - Admin đổi sale cho bất kỳ khách nào.
  - Duyệt qua bot (Won/Lost của agent) giữ nguyên như hiện nay.
- **Đồng ý:** muốn xác nhận chỗ thì khách phải đồng ý mục `enrollment`. Các mục khác chỉ để ghi lại và xem.
- **Nội dung chuyển khoản:** `ABM <mã khoản phải thu>`, ví dụ `ABM HP000123`.
- **Tài khoản ngân hàng của đơn vị:** Admin sửa trong bảng `org_setting`.
- **Hạ tầng:** mọi bảng mới đều dùng `version`/`last_txn_id` và ghi qua `GuardedTx` (ADR-003). Mỗi phase có migration riêng, đánh số tiếp từ `0006`.

## Ngoài phạm vi

- Mọi mục trong danh sách "Cố ý không có trong bản này" của PRD (trừ "Đưa lên máy chủ", vì CRM đã chạy trên máy chủ).
- Thay pipeline B2B.
- Chạy local.
- Người giám hộ.
- Đồng bộ MISA.
- Gửi Zalo, SMS hoặc email.
- Tạo mã QR.
- Lịch học lặp theo thứ.
- Thêm công cụ bot mới cho tổ chức, kế toán hoặc giáo viên.
- Production. Kế hoạch này chỉ làm trên eval.

## Các phase

| # | Phase | Effort | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 01 | [Nền tảng: vai trò, pipeline, sản phẩm, đồng ý, ADR](phase-01-foundation-roles-pipeline.md) | 2d | — | completed |
| 02 | [Tuyển sinh: khách, hành trình, giữ 3 tháng, đối tác](phase-02-admissions-customers-journey.md) | 3d | 01 | completed |
| 03 | [Tổ chức: khóa, lớp, buổi, ghi danh](phase-03-academic-classes-enrollment.md) | 2d | 02 | completed |
| 04 | [Giáo viên và điểm danh](phase-04-teacher-attendance.md) | 1d | 03 | completed |
| 05 | [Kế toán: học phí, phân bổ, hàng đợi](phase-05-accounting-fees.md) | 2.5d | 04 | completed |
| 06 | [Báo cáo, dữ liệu cá nhân, bot, tài liệu](phase-06-reports-privacy-bot-docs.md) | 1.5d | 04, 05 | completed |
| 07 | [Deploy eval và kiểm thử theo vai trò](phase-07-eval-rollout.md) | 0.5d | 06 | pending |

Chạy tuần tự từ 01 đến 07. Các phase sửa chung `packages/contracts`, `commands.ts`, `router.tsx` và dùng chuỗi số migration, nên không chạy song song.

## Tiêu chí nghiệm thu

- `pnpm -F @abm/crm test` exit 0. Toàn bộ test cũ và test mới đều xanh.
- `pnpm -F @abm/crm typecheck` và `pnpm -F @abm/crm build` đều exit 0.
- Mỗi quy tắc dưới đây có ít nhất một test backend:
  - Ngày hết hạn giữ khách là 3 tháng lịch theo giờ Việt Nam. Tháng đích thiếu ngày thì lấy ngày cuối tháng, ví dụ 31/1 thành 30/4.
  - Sale khác không thấy số điện thoại và không sửa được khách đang được giữ.
  - Khách đã thắng không bị nhả về hồ chung.
  - Không nhảy cóc bước bắt buộc. Tuyển sinh không tự tick các bước chia lớp, thu học phí, vào học.
  - Lead chỉ được thắng khi bước xác nhận nhu cầu đã xong và bước học thử đã xong hoặc đã bỏ qua.
  - Nguồn `partner` bắt buộc gắn hợp đồng đang hiệu lực.
  - Số học viên của lớp chỉ đếm ghi danh `confirmed` và `studying`.
  - Bảo lưu bắt buộc có ngày hết hạn. Học lại thì quay về đúng trạng thái trước khi bảo lưu.
  - Gán giáo viên cho lớp nhận user `teacher` hoặc `admin`, từ chối các vai trò khác.
  - Điểm danh mặc định là "chưa điểm danh". Lần đầu có mặt hoặc đi trễ thì đánh dấu bước "Vào học".
  - Số dư tính từ các khoản phân bổ. Thu đủ học phí khóa thì đánh dấu bước "Thu học phí khóa".
  - API trả tiền không trả số tiền cho giáo viên và tuyển sinh.
  - Xóa hồ sơ chỉ ẩn tên và số điện thoại, chứng từ tiền vẫn giữ.
- Đã deploy lên eval. Chạy thử theo kịch bản của phase 07 cho từng vai trò và đạt.

## Rủi ro

- **Phải dựng lại bảng `app_user` và `lead`** để sửa ràng buộc CHECK. Cả hai bảng có nhiều khóa ngoại trỏ tới.
  - Mẫu `_new` rồi `RENAME` của `0004` sẽ hỏng khóa ngoại khi bảng có dữ liệu. Kongming đã thử và xác nhận điều này.
  - Phase 01 dùng trình tự "chép ra bảng backup, xóa, tạo lại, chép vào", có test giữ dữ liệu đi kèm.
  - Sao lưu D1 trước khi chạy trên eval.
- **`GuardedTx` chỉ nhận một danh sách bảng cố định.** Mỗi lệnh phải ghi ít nhất một dòng có version, gọi là dòng neo. Quy tắc này được ghi ở phase 01, Task 1.2.
- **CPU của gói miễn phí:** báo cáo và phân bổ tiền phải dùng truy vấn tổng hợp trong SQL, không lặp trong JS.
- **Phạm vi lớn:** mỗi phase có điểm dừng xanh riêng. Không gộp phase.
- **Rò dữ liệu cá nhân qua bot:** phase 06 có test MCP cho việc che số điện thoại.
