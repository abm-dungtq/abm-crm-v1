# Sửa lỗi từ kiểm thử đa chiều

Ngày 2026-10-04. Sửa theo [báo cáo tổng hợp](phase-04-consolidated-findings.md) và quyết định user 11:43. Phạm vi: `apps/crm`, `packages/contracts`, docs liên quan.

## Kết quả

Đã sửa 26/30 lỗi: D-01..D-12 (D-09 tính chung với S-06), S-01, S-02, S-04, S-06, S-07, S-09, S-10, U-01..U-08. Không sửa theo quyết định: S-03, S-05 (sai lệch đã chấp nhận), S-08, D-13 (hoãn MVP1). Các mục này ghi trong [plan eval](../../261004-1005-crm-mvp1-eval-ui/plan.md) và [ADR-005](../../../docs/adr/adr-005-command-contracts.md).

## Nguyên nhân và cách sửa

| ID | Nguyên nhân | Sửa |
|---|---|---|
| D-01 | Test dựa vào `assigned_at` tuyệt đối trong seed | Test đặt `assigned_at` = now trước khi thử nhả sớm |
| S-01 | `canReadAudit` cho mọi vai trò khác Sale, Admin xem toàn org | Chỉ Leader/Trưởng phòng/BGĐ, theo `leadScope`; bỏ banner PROPOSED; cập nhật ma trận quyền |
| S-02 | Kiểm trùng trả code/stage/owner mọi lead trong org | Lead ngoài scope chỉ báo "đã có trong hệ thống" |
| S-04 | Replay trả kết quả lưu mà không kiểm quyền hiện tại | `replayInScope` kiểm lại lead đích (từ leadId, task, approval hoặc kết quả) |
| S-06/D-09 | Subquery owners của account không áp scope | Áp `leadScope(actor, 'l2')` |
| S-07 | Kiểm "đã có pending" là pre-read, không khoá | `GuardedTx.assert` trong batch: đúng một pending owner_change/lead, nếu không batch rollback → 409 |
| S-09 | Owner được duyệt mọi đề xuất stage của agent | `mayDecideApproval` dùng chung: owner_change và Won/Lost chỉ Leader của team |
| D-02/D-03 | `lower()` SQLite chỉ gấp ASCII; số trong truy vấn chữ khớp mọi SĐT | So khớp phía Worker bằng `foldText`; chỉ so SĐT khi truy vấn giống số điện thoại, chuẩn hoá `+84` |
| D-04 | So tên công ty bằng `lower()` | So `foldText` (hoa/thường, dấu, khoảng trắng) |
| D-05 | Phone chỉ giới hạn độ dài | Zod: ≥ 9 chữ số |
| D-06 | `occurredAt` chỉ chặn tương lai | Không trước lúc giao (hoặc tạo) lead, không quá 7 ngày; ghi vào QĐ4 |
| D-07/D-12 | Won không có đầu vào giá trị | `wonValue` (số nguyên > 0) + `wonNote` bắt buộc; lưu `expected_value` và cột mới `won_note` (migration `0002`); dialog Won có 2 trường; đề xuất Won của agent thiếu giá trị bị từ chối |
| D-08 | Hoàn thành task phụ kèm việc tiếp chuyển con trỏ, bỏ Next Action cũ | Chỉ chuyển con trỏ khi hoàn thành chính Next Action (hoặc lead chưa có) |
| D-10 | MST không tên công ty bị bỏ im lặng | Zod báo lỗi `companyName` |
| D-11 | `normalizePhone` không xử lý `00` | Bỏ tiền tố `00` trước khi đổi `84` → `0`; chuyển hàm sang `@abm/contracts` |
| S-10 | Từ khoá dài gây lỗi 500 | Middleware: `q` > 100 ký tự → 422 |
| U-01/U-02 | Drawer đóng chỉ dịch ngoài màn hình | `visibility: hidden` khi đóng; Esc đóng |
| U-03 | Nút "Tạo lead" ở page-head và topbar | Ẩn nút page-head trên mobile |
| U-04 | Cột kanban `78vw` cắt tiêu đề cột kế | Cột rộng `100vw - 72px`, cột kế lộ rõ |
| U-05 | Không chặn route nghiệp vụ cho Admin | Shell chuyển Admin về `/admin`; bỏ mục audit khỏi menu Admin |
| U-06 | `fmtDateTime` không có năm | Có năm khi khác năm hiện tại; audit luôn có năm |
| U-07 | `th` dùng `--muted` | Dùng `--text-2` |
| U-08 | Bộ lọc/banner hiện cả khi 403 | Bộ lọc chỉ hiện khi có dữ liệu; bỏ banner |

## Kiểm chứng

- Test hồi quy: `apps/crm/test/business-rules-hardening.test.ts`, 17 test. 15 test đầu chạy trên mã cũ (stash `src`): 15/15 đỏ. Trên mã đã sửa: xanh.
- Test cũ cập nhật theo quyết định: Won kèm giá trị/bằng chứng, MST kèm tên công ty, so tên công ty có dấu.
- `pnpm -F @abm/contracts typecheck`, `pnpm -F @abm/crm typecheck`: sạch. `pnpm -F @abm/crm test`: 127/127. `pnpm -F @abm/crm build`: đạt.
- Giao diện (Chrome headless, local `wrangler dev` 8787, D1 local reset + migration 0001–0002 + seed): 390px một nút tạo lead, drawer đóng không nhận focus, Esc đóng, cột kanban kế lộ ra; 1440px Admin vào `/leads` và `/leads/new` về `/admin`, Sale vào audit không thấy bộ lọc/banner, audit có năm, dialog Won khoá nút đến khi đủ giá trị và bằng chứng rồi đóng Won thành công, kiểm trùng ngoài scope không lộ mã. Không lỗi trang. Đã dừng `wrangler dev`.

## Review độc lập

Agent review không thấy lộ quyền hay sai thứ tự bind; xác nhận `tx.assert` rollback cả batch, trả STALE_VERSION và để `_guard` rỗng. Đã sửa theo review:

- Replay `createLead` không kiểm lại scope (chỉ trả id người tạo đã nhận; trả 404 sẽ đẩy client tạo trùng).
- Audit `duplicateOverride` ghi "ngoài phạm vi" thay cho mã lead ngoài scope.
- Leader không có team không được coi là Leader của lead không team.
- Truy vấn SĐT một phần bắt đầu bằng `84` không bị đổi thành `0…` (chỉ đổi khi có `+` hoặc đủ ≥ 9 chữ số).
- Index `approval(lead_id, kind, status)` trong migration `0002`.
- Ô giá trị Won coi dấu phẩy là không hợp lệ.
- Thêm test race bằng trigger: bỏ `tx.assert` thì cả test này và test hai request song song đều đỏ.

Giữ nguyên, có lý do:
- Audit của Leader gồm cả lead trong hàng chờ phòng ban. Leader đã thấy và giao được các lead này, nên audit theo cùng `leadScope`.
- Đề xuất Won của agent thiếu giá trị chỉ từ chối được. Bản eval chưa có đường tạo đề xuất agent; MVP1 thật bắt buộc giá trị khi tạo đề xuất.

## Giới hạn

- Tìm kiếm có `q` đọc mọi lead trong scope rồi lọc phía Worker; kiểm trùng tên công ty đọc mọi account của org. Đủ cho quy mô eval; MVP1 thật nên lưu cột tên đã chuẩn hoá có index.
- Kiểm tra CHECK `expected_value` ở DB chưa thêm (SQLite cần rebuild bảng); ràng buộc nằm ở Zod.
