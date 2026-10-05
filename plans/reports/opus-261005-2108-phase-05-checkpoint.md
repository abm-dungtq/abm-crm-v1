# Checkpoint sau Phase 05 (Kế toán, học phí)

Ngày: 2026-10-05. Người duyệt: Opus 5.5. Chỉ duyệt, không sửa code.

## Kết luận: **GO-with-fixes**

Sổ tiền đúng ở đường chính:

- số dư không lưu thành cột;
- hoàn tiền không phân bổ được;
- mã khoản lấy từ bộ đếm;
- mọi update dùng version.

Còn 2 lỗi mức High cần sửa trước khi lên eval:

- có kẽ hở cho phép phân bổ tiền vào một khoản vừa bị hủy;
- hai test chạy song song báo "đạt", nhưng thật ra chặn bằng guard version, không bằng `tx.assert` tổng tiền. Nghĩa là chưa có test nào chứng minh `tx.assert` chặn vượt tiền.

Ngoài ra có 3 lỗi Medium:

- sổ tiền của học viên bị mất khoản cũ;
- không có đường nào lấy được id và version để thu hồi phân bổ;
- bước học phí có thể sai khi hai người ghi cùng lúc.

Bằng chứng tôi tự chạy: `vitest run test/fees.test.ts` cho 14/14 test đạt. Phần typecheck, build và cả bộ 308 test lấy theo số liệu của controller.

---

## 1. Kiểm từng invariant

| # | Invariant | Kết quả | Bằng chứng |
|---|---|---|---|
| 1a | Ghi tiền song song có `tx.assert` `COALESCE(SUM)` trong batch, đặt sau INSERT | **Đạt một phần** | `allocatePayment`: insert ở `fees.ts:250-256`, rồi assert ở `:258-259`. `recordPayment` tự phân bổ: insert ở `:217-220`, rồi assert ở `:222`. SQL ở `:16-17`. **Thiếu:** không assert `charge.status = 'open'` trong batch (xem F1). |
| 1b | Có test `Promise.all` chứng minh chặn | **Không đạt về bản chất** | Test `fees.test.ts:339-362`: cả hai lệnh gửi `version: 1` cho cùng payment, nên lệnh sau hỏng ở guard version payment (`fees.ts:249`), không phải ở assert tổng. Test `:364-386`: cả hai lệnh cùng gọi `markStepDone` trên cùng `lead_step` version (`learner-commands.ts:265`), nên lệnh sau hỏng ở guard `lead_step`. Bỏ `tx.assert` ở `fees.ts:222` và `:258-259` thì cả hai test vẫn đạt (suy từ luồng code, chưa chạy thử vì không được sửa source). Xem F2. |
| 2a | Mọi update dùng version của client | Đạt | Contract: `voidCharge`, `allocatePayment`, `revokeAllocation`, `setInvoiceRef`, `moveEnrollmentCharges`, `updateOrgBank` đều có `version` (`contracts/src/index.ts:560-594`, `expectedVersion: true` ở `:450-456`). Handler: `:183/188`, `:233/249`, `:277-278`, `:288-289`, `:300/305`, `:321-323`. Riêng `moveEnrollmentCharges` update từng charge bằng version server vừa đọc (`:306`). Chấp nhận được, vì dòng neo là ghi danh đích, dùng version của client. |
| 2b | `revokeAllocation` đòi `revoked_at IS NULL` | Đạt | `fees.ts:276` kiểm trước. Trong batch, version bump (`:278`) chặn hai lệnh thu hồi chồng nhau. |
| 3a | Hoàn tiền không bao giờ được phân bổ | Đạt | `fees.ts:205` (tự phân bổ chỉ khi `in`), `:234-235` (comment và chặn), `:374` (hàng đợi bỏ refund). Có test `:284-304`. |
| 3b | Số dư tính từ phân bổ, không lưu | Đạt | `chargeBalanceSql` ở `fees.ts:14`. Bảng `charge` không có cột số dư (`0010_fees.sql:25-43`). |
| 4a | `lead_step` chỉ đổi qua `markStepDone` và `reopenStep` | Đạt | `fees.ts:133,136`. Không có `UPDATE lead_step` nào trong `fees.ts`. `reopenStep` ở `learner-commands.ts:270-277` chỉ đổi `done → open`. |
| 4b | Định nghĩa "đã thu đủ" | Đạt | `fees.ts:125-139`: có ít nhất 1 khoản `tuition` `open`, và tổng số còn lại của mọi khoản `open` trên ghi danh sống ≤ 0, có tính adjustment âm. DB có assert "mỗi lead một ghi danh sống" (`academic-commands.ts:193`), nên vòng lặp không update cùng một bước hai lần. **Hở khi ghi song song:** xem F5. |
| 4c | Khoản `tuition` bắt buộc có `enrollmentId` | Đạt | `contracts/src/index.ts:554` |
| 4d | `createCharge` kiểm tổ chức, khách và ghi danh sống | Đạt (chỉ kiểm trước khi ghi) | Khách: `fees.ts:150-152` (cùng org, chưa archive). Ghi danh: `:155-157` (cùng org qua `loadEnrollment` `:61`, cùng khách, trạng thái sống). Không có assert trong batch. Rủi ro thấp. |
| 5a | Mã `HP%06d` lấy từ `fee_counter` | Đạt | `fees.ts:161-171`. Insert, đọc và tăng bộ đếm nằm trong cùng batch D1, nên được tuần tự hóa. |
| 5b | Lỗi UNIQUE khi chạy song song trả `STALE_VERSION` | Đạt, nhưng phạm vi quá rộng | `commands.ts:127-128` bắt mọi `UNIQUE constraint failed` của **mọi lệnh**. Xem F6. |
| 5c | Nội dung chuyển khoản là `ABM <code>` | Đạt | `fees.ts:421` |
| 5d | Chỉ tự phân bổ khi memo khớp mã | Đạt theo plan | Memo phải chứa **đúng một** mã `HP\d{6}` (`fees.ts:20,203,205`), khoản đang `open` và số còn lại ≥ số tiền (`:209`). Regex phân biệt hoa thường (F8). |
| 6a | Migration chèn `org_setting` từ `organization` | Đạt | `0010_fees.sql:17-18` |
| 6b | Seed demo dùng `INSERT OR IGNORE` | Đạt | `seed/demo.sql:259` |
| 6c | Thứ tự `reset-db` | Đạt | `test/helpers/reset-db.ts:5,11`: các bảng tiền đứng đầu; `fee_counter` và `org_setting` đứng trước `organization`. |
| 7a | Money roles là accountant, admin, director | Đạt | `contracts:105`, `fees.ts:56`. Mọi query fee đều gọi `canReadMoney` (`:340,370,387,411,427,454`). Quyền ghi chỉ có accountant và admin (`contracts:449-455`), riêng `updateOrgBank` chỉ admin (`:456`). Web khóa form ghi với director (`fees.tsx:12,46`, `fees-queue.tsx:8,24`). |
| 7b | Teacher, sale, leader không nhận số tiền sổ | Đạt | Không có cột `amount`, `charge` hay `payment` trong `academic-queries.ts`, `attendance.ts`, `roster.ts` và `learner-queries.ts`. Test `fees.test.ts:237-242` và `:327-336`. **Lưu ý:** `priceVnd` (giá niêm yết) vẫn trả cho sale và leader ở `learner-queries.ts:163` và `queries.ts:329`. Test chỉ dò khóa chứa `amount`, nên giá này lọt qua. Xem Q1. |
| 7c | Accountant vào `/` thì chuyển sang `/fees`; có `GET /fees/contacts?q=` | Đạt | `dashboard.tsx` (`Navigate to="/fees"`), route ở `index.ts:157-161` |
| 7d | Bot không đụng được tiền | Đạt | `mcp-tools.ts:20-61` không có tool nào về tiền. |

## 2. Migration 0010 có an toàn trên eval không

**An toàn.**

- Chỉ tạo bảng mới và 5 index. Không `ALTER` hay xóa gì.
- `INSERT … SELECT FROM organization` có thể chạy lại trên DB rỗng.
- Các FK đều trỏ tới bảng đã có: `enrollment` (0008), `contact`, `app_user`, `organization`.
- Vẫn phải sao lưu D1 theo phase 07, vì 0006-0010 lên cùng một đợt.

**Nên sửa trước khi chạy trên eval (F7):** `charge.code` đang UNIQUE trên toàn bảng, trong khi `fee_counter` đếm riêng theo tổ chức. Sửa bây giờ còn rẻ, vì migration chưa chạy trên eval.

## 3. Verify của từng Task 5.x

| Task | Verify | Kết quả |
|---|---|---|
| 5.1 | test exit 0 | Đạt (controller: 22 file, 308 test) |
| 5.2 | typecheck exit 0 | Đạt (controller) |
| 5.3, 5.4 | dồn sang 5.6 | — |
| 5.5 | typecheck và build exit 0 | Đạt (controller). Ba trang `fees.tsx`, `fees-queue.tsx`, `fee-guide.tsx` và form ngân hàng trong `admin.tsx` đều có. |
| 5.6 | `fees.test.ts` có trong output, không có `failed` | Đạt, 14/14. Test 1-12 đúng theo plan. Test 13 đạt nhưng không chứng minh điều plan muốn chứng minh (F2). |

---

## 4. Danh sách sửa

### Code now

**F1 (High). Có thể phân bổ tiền vào khoản vừa bị hủy.**

- Chỗ sửa: `apps/crm/src/worker/fees.ts:144-146` (`assertChargeTotals`) và `:222`.
- Lỗi xảy ra thế này:
  - `voidCharge` có assert "không còn phân bổ" (`:189`).
  - Nhưng `allocatePayment` và `recordPayment` chỉ kiểm `status = 'open'` lúc đọc trước (`:209`, `:244`).
  - Nếu lệnh hủy commit trước, batch phân bổ vẫn qua, vì `chargeWithinSql` không xét `status`. Tiền nằm trên một khoản `void` và biến mất khỏi mọi tổng.
- Cách sửa: trong `assertChargeTotals`, và ở chỗ tự phân bổ của `recordPayment`, thêm:
  ```ts
  tx.assert(`SELECT status = 'open' FROM charge WHERE id = ?`, [chargeId]);
  ```

**F2 (High). Thêm test chứng minh `tx.assert` tổng tiền thật sự chặn.**

- Chỗ sửa: `apps/crm/test/fees.test.ts`, sau `:386`.
- Test cần thêm:
  - Một khoản `deposit` 1.000.000 (không có `tuition`, nên `syncTuitionStep` không ghi `lead_step`).
  - Hai **payment khác nhau**, mỗi cái 1.000.000.
  - `Promise.all` hai lệnh `allocatePayment`, mỗi lệnh phân bổ 1.000.000 vào khoản đó.
- Kết quả mong đợi: đúng một lệnh 200, một lệnh 409, và tổng phân bổ = 1.000.000.
- Làm thêm một bản cho `recordPayment` với memo `ABM <code>` trên cùng khoản `deposit`.
- Đây là đường duy nhất mà chỉ assert tổng chặn được.

**F3 (Medium). Sổ tiền một học viên bị mất khoản cũ.**

- Chỗ sửa: `apps/crm/src/worker/fees.ts:391-392`.
- Lỗi: `contactLedger` lấy 300 khoản mới nhất **của cả đơn vị** (`listCharges`, `LIMIT 300` ở `:356`), rồi mới lọc theo học viên. Khi đơn vị có hơn 300 khoản, khoản cũ của học viên biến mất khỏi sổ.
- Cách sửa: đưa `c.contact_id = ?` vào `WHERE` của SQL, ví dụ thêm `filters.contactId` vào `listCharges`.

**F4 (Medium). `revokeAllocation` không có đường gọi.**

- Chỗ sửa: `apps/crm/src/worker/fees.ts:393-406`.
- Lỗi: không endpoint nào trả `allocationId` và `version`. `contactLedger` gom theo payment. Nếu tự phân bổ nhầm, kế toán không sửa được nếu không vào DB.
- Cách sửa: thêm `allocations: [{id, version, paymentId, chargeId, chargeCode, amountVnd, createdAt}]`, chỉ lấy dòng `revoked_at IS NULL`, vào `contactLedger`.
- Màn hình cho void, revoke và move: xem Q3.

**F5 (Medium). Bước "Thu học phí" có thể sai khi hai người ghi cùng lúc.**

- Chỗ sửa: `apps/crm/src/worker/fees.ts:125-139`.
- Ví dụ: hai lần phân bổ 3 triệu và 2 triệu, từ hai payment khác nhau, vào khoản 5 triệu. Lúc đọc, mỗi lệnh thấy còn nợ, nên không lệnh nào đánh `done`. Cả hai commit xong thì đã thu đủ, nhưng bước vẫn `open` cho tới lần ghi tiền sau.
- Plan Task 5.3 bước 9, gạch cuối, đã yêu cầu "assert để batch tự hỏng nếu có người ghi chen", nhưng chưa làm.
- Cách sửa: mỗi ghi danh có ít nhất một khoản `tuition` `open` thì thêm `tx.assert` tính lại tổng số còn lại của ghi danh trong batch:
  - đã quyết định `done`: assert `<= 0`;
  - còn lại: assert `> 0`.
- Lệnh thua sẽ nhận `STALE_VERSION`, tải lại rồi làm lại.

**F6 (Low). Mọi lỗi UNIQUE đều bị đổi thành "dữ liệu vừa đổi".**

- Chỗ sửa: `apps/crm/src/worker/commands.ts:127-128`.
- Lỗi: mọi lỗi UNIQUE của mọi lệnh đều thành `STALE_VERSION`, nên che cả lỗi trùng thật (ví dụ `class_teacher`).
- Cách sửa: chỉ đổi khi message chứa `charge.code`.

**F7 (Low, nhưng nên sửa trước eval).**

- Chỗ sửa: `apps/crm/migrations/0010_fees.sql:28`.
- Đổi `code TEXT NOT NULL UNIQUE` thành `UNIQUE (organization_id, code)`. Nếu không, tổ chức thứ hai mãi nhận `STALE_VERSION` ở `HP000001`.

**F8 (Low). Memo chữ thường không được tự phân bổ.**

- Chỗ sửa: `apps/crm/src/worker/fees.ts:203`.
- Ngân hàng hoặc người nộp gõ `abm hp000001` thì tiền rơi vào hàng đợi.
- Cách sửa: `.toUpperCase()` memo trước khi so regex.

### Plan text

**P1. Bảng lệnh của phase 05 còn ghi kiểu cũ.**

- Chỗ sửa: `phase-05-accounting-fees.md:94` và `:96`.
- Sửa bảng lệnh cho khớp code:
  - `revokeAllocation`: `true`, input `{allocationId, version, reason}`;
  - `moveEnrollmentCharges`: `true`, input `{fromEnrollmentId, toEnrollmentId, version}`, trong đó version là của ghi danh đích.

**P2.**

- Chỗ sửa: `phase-05-accounting-fees.md:128`.
- Đổi "đọc version của allocation" thành "dùng `version` client gửi".

**P3. Test 13 không chứng minh điều plan nói.**

- Chỗ sửa: `phase-05-accounting-fees.md:201` và `:218`.
- Ghi rõ: test 13 chứng minh guard version của payment. Thêm test 14: hai payment khác nhau cùng phân bổ vào một khoản `deposit`, để chứng minh `tx.assert` tổng (F2).

**P4. Ma trận quyền ghi sai quyền của Admin.**

- `docs/security/permission-matrix-v1.md:54` ghi Admin `R` cho học phí, nhưng code cho Admin ghi (`contracts:449-455`), và đúng theo plan Task 5.2.
- Thêm vào phase 06 Task 6.5:
  - sửa dòng đó thành Admin `R/W`;
  - ghi BGĐ `R`;
  - ghi rõ chỉ Admin sửa tài khoản ngân hàng.
- Thêm file `docs/security/permission-matrix-v1.md` vào mục Files (`phase-06:40-42`).

### Plan text: phase 06 đã lệch so với code phase 01-05

**P5. `phase-06:81` (`unmarkedToday`).**

- Plan chưa nói "học viên của buổi" là ai.
- Phải dùng đúng quy tắc danh sách lớp của `attendance.ts:81-112`:
  - buổi `regular`: ghi danh `confirmed` hoặc `studying`, hoặc ghi danh đã kết thúc (`completed`, `transferred`, `withdrawn`) với `ended_at > starts_at`;
  - buổi `trial`: `trial_booking` ở trạng thái `booked` hoặc `done`;
  - buổi `makeup`: đúng một học viên từ `makeup_for_attendance_id`.
- Không dùng `COUNTED_ENROLLMENT`, vì sẽ lệch với màn điểm danh.
- Nên export hàm lấy danh sách lớp hoặc SQL chung, không viết lại lần thứ hai.

**P6. `phase-06:85` (`teachingHours`).**

- `class_teacher` cho phép nhiều giáo viên trên một lớp (`0008_academic.sql:30-35`). Giáo viên gán theo lớp, không theo buổi.
- Phải ghi rõ cách tính, ví dụ: "mỗi giáo viên được gán nhận đủ giờ của buổi".
- Phải ghi rõ loại buổi nào được tính: `regular`, `makeup`, `trial`.
- Câu 88 (`myHours`) dùng cùng định nghĩa này.

**P7. `phase-06:83-84` (tuổi nợ và tiền theo ngày).**

- `debtAging`: ghi "dùng `chargeBalanceSql` export từ `fees.ts:14`, chỉ khoản `open`, có tính adjustment âm".
- `cashByDay`: ghi "theo ngày VN của `payment.received_at`", có index `payment_org_received`.

**P8. `phase-06:101` (hàm `mayInspect`).**

- Chữ ký thật là `mayInspect(actor, row: {owner_user_id, owner_team_id}, held)` (`learner-queries.ts:15`).
- Plan phải nói cách tính `held` (qua `learner-hold.ts`), và rằng `leadDetail` cần đọc `contact.owner_user_id` cùng `hold_*`.

**P9. `phase-06:69` (ẩn danh).**

- Ghi rõ: `charge.contact_id` vẫn trỏ vào khách đã ẩn danh, nên màn học phí sẽ hiện "Đã ẩn danh". Đó là hành vi đúng.
- Ghi rõ: `searchFeeContacts` (`fees.ts:426-451`) không lọc `archived_at`, cần lọc để không tạo khoản mới cho khách đã ẩn danh. `createCharge` đã chặn ở `:150`, nhưng ô tìm vẫn hiện khách đó.
- Chữ tự do có thể còn chứa tên hoặc số điện thoại: `payment.memo`, `payment.payer_note`, `lead.need_summary`, `consent.note`. Xem Q4.

**P10. `phase-06` Task 6.6.**

- Thêm test: accountant gọi `tools/list` chỉ thấy `whoami`.
- Thêm test: ẩn danh không đổi tổng `amount_vnd` của `charge` và `payment_allocation`. Hiện plan chỉ kiểm số dòng.

---

## 5. Câu hỏi cho user

1. **Giá niêm yết.** Sale và leader đang thấy giá niêm yết của sản phẩm (`priceVnd` ở `/products` và trong hồ sơ học viên). PRD nói "không thấy số tiền". Ý đó là chỉ tiền thu và nợ, hay cả giá bán? Tôi đoán là chỉ tiền thu và nợ, vì tuyển sinh cần báo giá.
2. **Hoàn tiền.** Hoàn tiền hiện không gắn với học viên nào (`payment` không có `contact_id`). Sổ của một học viên vì vậy không hiện khoản hoàn. Có cần gắn hoàn tiền vào học viên không?
3. **Màn hình sửa sai.** Chưa có màn hình nào cho Hủy khoản, Thu hồi phân bổ, Chuyển khoản theo lớp mới, và Sổ tiền của một học viên. API đã có. Làm ngay trước phase 06, hay đưa vào phase 06?
4. **Phạm vi ẩn danh.** Khi ẩn danh, có xóa chữ tự do có thể chứa tên trong nội dung chuyển khoản và ghi chú người nộp không? Plan hiện nói "giữ chứng từ tiền".
5. **Một lần chuyển khoản bị ghi hai lần.** Hai kế toán có thể ghi trùng cùng một lần chuyển khoản; hiện không có ô "số tham chiếu ngân hàng" để chặn trùng. Có cần thêm không?

## 6. Rủi ro tiếp theo cần theo dõi

**Sửa sai trên sổ tiền thật ở eval.** Mỗi lần tự phân bổ nhầm (memo khớp sai khoản), ghi trùng tiền, hay chuyển lớp mà chưa chuyển khoản phải thu, kế toán hiện không tự sửa được trên web (F4, Q3). Bước "Thu học phí" có thể lệch so với tiền thật khi ghi song song (F5). Trước khi cho kế toán dùng thật, cần đủ ba thứ: F1 và F2 có test, đường thu hồi phân bổ dùng được, và một truy vấn đối soát định kỳ so `tuition_paid` với số còn lại tính lại.
