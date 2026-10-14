# Soát code Phase 1: đồng bộ lead từ chatbot vào CRM (Worker)

Ngày 14/10/2026. Người soát: code-reviewer (Opus). Chỉ đọc code, không sửa file nào.

## Phạm vi
- Commit `a3915e7`, so với `1a60c33`. Commit này gộp cả việc Zalo OA trước đó. Tôi chỉ soát phần đồng bộ lead.
- Các file đã soát:
  - `apps/crm/migrations/0021_lead_program_sync.sql`
  - `packages/contracts/src/index.ts`
  - Trong `apps/crm/src/worker/`: `learner-commands.ts`, `commands.ts`, `queries.ts`, `learner-queries.ts`
  - Trong `apps/crm/src/worker/inbox/`: `intake.ts`, `assignment.ts`, `worker-commands.ts`, `inbox-routes.ts`
  - Các test đi kèm.
- Bằng chứng:
  - Chạy test liên quan: `vitest run inbox-intake admissions inbox-assignment inbox-zalo-oa-schema commands` cho 5 file, 82 test, đều đạt.
  - Chạy thử migration 0001→0021 trên SQLite trong bộ nhớ (`node:sqlite`), bật khóa ngoại (foreign key).

## Kết luận chung
Phần lõi làm đúng yêu cầu:
- Migration an toàn.
- Chặn tạo lead học viên trùng.
- Ghi chú vào lead đang mở thay cho lead chờ.
- Lỗi Lark 230013 dừng ngay, không thử lại.
- Chỉ nhắn Lark riêng một lần.

Còn **1 lỗi High** về phân quyền: `contactId` mới thêm vào `createLead` không kiểm tra khách có thuộc người khác hay không. Thêm một số lỗi Medium:
- Bộ lọc đại từ bỏ nhầm tên thật.
- Khớp chương trình theo tên quá lỏng và không xử lý trường hợp nhiều chương trình cùng khớp.
- Lead B2B vẫn có thể bị tạo trùng.
- Thứ tự deploy so với giao diện.

Không có lỗi Critical.

---

## Critical
Không có.

## High

### H1. `createLead` nhận `contactId` mà không kiểm tra quyền trên khách: lách được luật "khách đang do sale khác giữ"
- **Chỗ lỗi:**
  - `apps/crm/src/worker/commands.ts:295-300`: chỉ kiểm tra khách cùng tổ chức và chưa lưu trữ.
  - `packages/contracts/src/index.ts:267`: thêm `contactId` vào lệnh công khai.
  - `apps/crm/src/worker/inbox/intake.ts:414-420`: tự điền `contactId` lấy từ hội thoại.
- **Vấn đề:**
  - `createLearnerLead` có `decideContact`, nên khách do sale khác giữ thì trả FORBIDDEN.
  - `createLead` (B2B) thì không kiểm tra gì. Nó gắn lead mới và ghi thêm SĐT/email vào bất kỳ khách nào trong tổ chức, rồi trả `contactId`. Tên khách sau đó hiện trong danh sách lead của người tạo.
  - `linkIntakeContact` thì có kiểm tra `customerScope`. Hai đường cùng gắn khách nhưng một đường không kiểm tra.
- **Ví dụ lỗi:**
  1. Khách K là học viên do sale B giữ, và hội thoại Zalo của K đã gắn với K.
  2. Sale A mở lead chờ của hội thoại đó và bấm phân loại **B2B**.
  3. `classifyIntake` tự truyền `contactId = K` → `createLead` tạo lead B2B do A phụ trách, gắn vào khách của B.
  4. Nếu form có SĐT thì SĐT đó cũng được ghi vào K.
  5. Kết quả: không có lỗi FORBIDDEN, và luật giữ khách 3 tháng bị lách.

  Gọi thẳng `/api/commands/createLead` với `contactId` của khách khác cũng ra kết quả tương tự.
- **Sửa:**
  - Khi có `contactId`, đọc `owner_user_id, hold_expires_at` của khách.
  - Nếu khách đang được giữ (`heldNow`) bởi người khác thì trả `FORBIDDEN` với cùng câu `heldByOtherMessage`, giống `decideContact`.
  - Không nên dùng `customerScope`, vì khách B2B thường không có người giữ.
  - Thêm test: sale A phân loại B2B trên hội thoại gắn với khách của sale B → 403.

## Medium

### M1. Bộ lọc đại từ so sánh sau khi bỏ dấu (`foldText`), nên bỏ nhầm tên thật
- **Chỗ lỗi:** `apps/crm/src/worker/inbox/intake.ts:39-50`
- **Vấn đề:** `foldText` bỏ dấu, nên các tên thật sau bị coi là đại từ:
  - "Chi" (tên) thành `chi` (chị)
  - "Chu" (họ) thành `chu` (chú)
  - "Bắc" thành `bac` (bác)
  - "Cơ" thành `co` (cô)
  - "Ban" thành `ban` (bạn)
- **Ví dụ lỗi:**
  - Các tên bị bỏ mất: "Chi", "Chi Nguyễn", "Chu Hoa", "Bắc Hà".
  - "Anh Thư", "Anh Đào", "Anh Tuấn" (tên hai chữ bắt đầu bằng "Anh") cũng bị bỏ. Trường hợp này khó tách khỏi "anh Thư" (anh + tên), vì mô hình AI có thể viết hoa cả hai.
  - "Em" một chữ bị bỏ thì chấp nhận được, như yêu cầu.
- **Sửa:**
  - So sánh bằng chữ thường **giữ dấu** (`'anh','chị','em','cô','chú','bác','sếp','bạn','thầy'`), thay cho `foldText`. Cách này hết bỏ nhầm "Chi", "Chu", "Bắc", "Cơ", "Ban".
  - Với "Anh" + một chữ, chủ dự án cần chọn một trong hai:
    - giữ lại, chấp nhận "anh Long" lọt qua (lời dặn trong câu lệnh trích đã chặn phần lớn trường hợp này);
    - bỏ đi, chấp nhận mất "Anh Thư".
  - Thêm test cho "Chi", "Chu Hoa" và "Anh Thư", theo lựa chọn ở trên.

### M2. Khớp chương trình: lấy kết quả đầu tiên khi có nhiều chương trình khớp, và khớp theo tên quá lỏng
- **Chỗ lỗi:** `apps/crm/src/worker/inbox/intake.ts:116-133`
- **Phần đã đúng:** số tiền 0 và "miễn phí" không bao giờ khớp theo giá:
  - `parsePriceVnd` trả `null` khi không có chữ số;
  - `k`/`tr` yêu cầu số lớn hơn 0;
  - dãy chữ số phải từ 1000 trở lên.

  Vì vậy 6 chương trình giá 0 không bị khớp nhầm theo giá.
- **Vấn đề:**
  1. **Theo giá:** `products.find` lấy chương trình tạo sớm nhất. Nếu hai chương trình cùng giá, ví dụ hai khóa 199.000đ hoặc sau khi nhân viên sửa giá "báo giá riêng", thì gợi ý có thể sai mà không ai biết.
  2. **Theo tên:** khớp chuỗi con hai chiều (`pf.includes(folded) || folded.includes(pf)`), chỉ cần dài từ 2 ký tự. Ví dụ:
     - Có chương trình tên ngắn như "AI" thì mọi nội dung chứa "ai" đều khớp, như "tài chính" hay "Mai".
     - Khách nói "miễn phí" mà có hai chương trình chứa chữ "miễn phí"/"free" thì lấy chương trình đầu tiên.
- **Sửa:**
  - Lọc ra tất cả chương trình khớp. Chỉ trả kết quả khi có **đúng 1**, nhiều hơn 1 thì trả `null`. Làm vậy cho cả khớp theo giá và theo tên.
  - Khớp tên một phần nên theo ranh giới từ (so sánh theo từng từ), hoặc yêu cầu chuỗi dài từ 4 ký tự trở lên.
  - Thêm test: hai chương trình cùng giá 199.000đ thì không gợi ý; nội dung "miễn phí" thì không khớp chương trình giá 0 nào theo giá.

### M3. Lead B2B vẫn có thể tạo trùng trên khách đã gắn với hội thoại
- **Chỗ lỗi:** `apps/crm/src/worker/commands.ts:313-330` và hợp đồng `createLeadInput`, phần refine `contactId || phone || email`.
- **Vấn đề:**
  - Câu truy vấn kiểm tra trùng chỉ tìm qua SĐT, email, MST và tên công ty. Không có nhánh tìm theo `l.contact_id = ?6`.
  - Từ nay chỉ cần `contactId` là tạo được lead, không cần SĐT hay email.
- **Ví dụ lỗi:**
  1. Lead chờ được tạo trước khi hội thoại gắn khách.
  2. Sau đó khách có lead B2B đang mở.
  3. Nhân viên phân loại B2B mà để trống SĐT → không tìm thấy trùng → khách có 2 lead B2B mở.
- **Sửa:** thêm một nhánh `UNION SELECT 'contact', … FROM lead l WHERE l.contact_id = ?6 AND l.status IN ('queue','active')`.

### M4. Deploy Worker trước giao diện thì không chốt thắng được lead học viên nào
- **Chỗ lỗi:** `apps/crm/src/worker/learner-commands.ts:399`
- **Vấn đề:**
  - `winLearnerLead` bắt buộc lead có `product_id`.
  - Mọi lead đang có trên D1 thật (kể cả L-0047) đều có `product_id = NULL`.
  - Hiện chưa có giao diện nào gọi `setLeadProgram`. Tìm `setLeadProgram` trong `apps/crm/src/web` không có kết quả nào.
- **Ví dụ lỗi:** Phase 5 deploy Worker phase 1 trước phase 2. Sale bấm "Chốt thắng" sẽ luôn bị báo thiếu "chương trình học", và không có chỗ nào để chọn.
- **Sửa (vận hành):** deploy Worker cùng lúc với giao diện chọn chương trình. Nếu không, điền `product_id` cho các lead học viên đang mở trước khi deploy.

### M5. Migration 0021 phải chạy trước khi deploy Worker
- **Vấn đề:** code mới dùng ngay hai thứ do migration tạo ra:
  - `LEAD_SELECT` (queries.ts) và `learnerDetail` JOIN với `l.product_id`;
  - `linkStatements` ghi loại `zalo_oa_uid`.
- **Ví dụ lỗi:** deploy Worker trước migration thì danh sách lead và chi tiết học viên báo lỗi `no such column`. Phân loại lead chờ Zalo OA thì lỗi CHECK, sau khi lệnh tạo lead đã commit. Khi đó lead đã có nhưng lead chờ vẫn ở trạng thái chờ, và người dùng nhận lỗi 500.
- **Sửa:** ghi rõ thứ tự trong phase 5: sao lưu, chạy migration, rồi mới deploy. Kế hoạch đã ghi gần như vậy, chỉ cần nói rõ thứ tự bắt buộc.

### M6. Mỗi lần trích lại đều ghi một ghi chú chứa toàn bộ thông tin
- **Chỗ lỗi:** `apps/crm/src/worker/inbox/intake.ts:297-311`
- **Vấn đề:** cron trích lại sau mỗi đợt khách nhắn (hết 15 phút không nhắn), khi chuyển cho người, và khi trả lại cho bot. Lần nào cũng ghi đủ các trường (tên, SĐT, nhu cầu…), kể cả khi không có gì mới.
- **Ví dụ lỗi:** khách nhắn nhiều ngày → lead có hàng chục ghi chú giống nhau. Ghi chú thật của sale bị trôi xuống dưới. Yêu cầu nói "các trường **mới** trích được", nhưng code đang ghi tất cả.
- **Sửa:** so với ghi chú hệ thống gần nhất của lead đó (hoặc lưu bản trích gần nhất). Chỉ ghi các trường đổi hoặc mới. Không có trường nào đổi thì không ghi, nhưng vẫn cập nhật `last_extracted_at`.

### M7. Tạo lead học viên theo `contactId` thì ghi thêm SĐT/email vào khách mà không kiểm tra SĐT có thuộc khách khác không
- **Chỗ lỗi:** `apps/crm/src/worker/learner-commands.ts:185-196`. Lệnh `INSERT … WHERE NOT EXISTS` mới thêm cho khách có sẵn.
- **Vấn đề:** khi chọn khách theo id, `createLearnerLead` không tra `loadPhoneIndex`. Nhánh mới vẫn ghi SĐT trong form vào khách được chọn. Phân loại từ hội thoại luôn chọn khách theo id (do H1/Task 1.4), nên trường hợp này sẽ hay gặp.
- **Ví dụ lỗi:**
  1. Bot trích SĐT của người nhà, mà SĐT này đang thuộc khách Y do sale B giữ.
  2. Sale A phân loại lead học viên trên hội thoại gắn với khách X của A → X có thêm SĐT của Y.
  3. Sau đó ai tạo lead theo SĐT này cũng thấy cả X (A giữ) và Y (B giữ). Kết quả là FORBIDDEN cho tất cả, kể cả sale B.
- **Sửa:** khi chọn theo id mà có SĐT, tra `loadPhoneIndex`. Nếu SĐT thuộc khách khác (`id ≠ contactId`) thì trả `DUPLICATE_SUSPECTED`, hoặc bỏ qua không ghi SĐT đó.

## Low

- **L1.** Khách đang có lead học viên mở nhưng đã hết hạn giữ thì nhận lỗi `VALIDATION_FAILED` ("hồ chung"), không phải `DUPLICATE_SUSPECTED`. Xem `learner-commands.ts:136-141`. `tx.assert` vẫn chặn được trùng, nên chỉ là thông báo lỗi chưa đúng.
- **L2.** `setLeadProgram` (`commands.ts:428`):
  - Dùng `loadLead`/`canSeeLead`, và cho thêm vai `head`/`director`. Vì vậy Trưởng phòng/BGĐ sửa được lead **học viên**, trong khi mọi lệnh học viên khác chỉ cho sale/leader/admin (`loadLearnerLead` có kiểm tra `mayEdit`).
  - Gửi thiếu cả `productId` lẫn `courseId` thì chương trình bị xóa mà không báo gì. Nên bắt buộc có `productId` (cho phép `null` khi muốn xóa thật).
- **L3.** 230013 (`worker-commands.ts:23-31`): UPDATE `app_user` không tăng `version` và không ghi audit. Nếu admin "liên kết lại Lark" đúng lúc đó thì việc so sánh version không thấy thay đổi này. Rủi ro thấp. Regex `/\bcode 230013\b/` khớp đúng định dạng `LarkError` ("code 230013: …"). Đã thấy test chứng minh lệnh thành `failed` ngay ở lần thử đầu.
- **L4.** Nhận khách cũ theo mã kênh (`intake.ts:280-290`): nếu `UPDATE … WHERE contact_id IS NULL` không đổi dòng nào (có người vừa gắn khách khác), biến `contactId` vẫn giữ khách tìm được. Ghi chú/lead chờ có thể gắn vào khách khác với khách của hội thoại. Nên đọc lại `conversation.contact_id` sau khi UPDATE.
- **L5.** `mergeIntakeFields` (`intake.ts:155`): sau khi nhân viên bấm xác nhận `program` đề xuất (`confirmProposedField`), `productId` cũ vẫn giữ nguyên, nên form điền sẵn sai chương trình.
- **L6.** Lark riêng gửi cả khi người phân loại chính là người phụ trách (tự nhắn cho mình). Việc giao hội thoại và gửi Lark chạy sau batch phân loại, nằm ngoài guard. Nếu bước này lỗi thì người dùng nhận 500, dù lead chờ đã được phân loại.
- **L7.** Thay đổi hành vi cần chủ dự án biết: hội thoại đã gắn khách thì **mọi** lần phân loại đều gắn lead vào khách đó. Ví dụ phụ huynh đăng ký cho 2 con qua cùng một Zalo: lần hai sẽ bị `DUPLICATE_SUSPECTED`, trừ khi form gửi `contactId` khác. Hiện giao diện chưa có chỗ để chọn khách khác.
- **L8.** Thiếu test theo yêu cầu của Task 1.4: "phân loại hai lần trên cùng hội thoại → còn 1 khách, lần hai bị `DUPLICATE_SUSPECTED`". Hiện chỉ có test tương tự qua `createLearnerLead` trực tiếp (`admissions.test.ts:105`), chưa có test qua `classifyIntake`.

---

## Kiểm tra theo 8 điểm được giao

1. **Migration 0021:** an toàn.
   - Chạy thử 0001→0021 bằng `node:sqlite`, bật khóa ngoại, có BEGIN/COMMIT:
     - giữ đủ 3/3 dòng `contact_point`;
     - `foreign_key_check` không báo lỗi;
     - index `contact_point_lookup` và ràng buộc PK được tạo lại;
     - `lead` có thêm khóa ngoại `product_id→product`, `course_id→course`.
   - Chỉ đổi loại `zalo_uid` khi giá trị trùng `external_thread_id` của hội thoại thuộc kênh `zalo_oa`. Dòng `zalo_uid` của kênh Zalo cá nhân không bị đổi.
   - Không bảng nào có khóa ngoại trỏ tới `contact_point` và không có trigger, nên cách "tạo bảng _new rồi đổi tên" (giống 0013) không gây lỗi.
   - Lệnh đổi loại không lọc theo tổ chức. Chỉ lỗi nếu mã OA trùng mã Zalo cá nhân, khả năng rất thấp.
   - Với dữ liệu thật hiện tại (1 khách, 2 điểm liên lạc), migration không có rủi ro.
2. **Chống trùng:** đúng.
   - `has_active_learner_lead` chỉ được kiểm tra ở nhánh `own`. Các nhánh khác đã bị chặn sẵn: khách do người khác giữ thì FORBIDDEN, khách ở hồ chung thì VALIDATION.
   - `tx.assert COUNT(*) = 1` đặt sau INSERT lead nên đúng cho cả khách mới lẫn khách cũ.
   - Lead won/lost không được tính, nên mở lại lead sau khi thua hoặc thắng vẫn được (test `admissions.test.ts:105`).
   - Nhập CSV: SĐT trùng trong file đã bị chặn từ trước, nên assert không làm hỏng việc nhập nhiều dòng.
3. **Ghi chú vào lead đang mở:** đúng. Nút "Cập nhật CRM" dùng chung `enqueueExtraction` → `applyExtractionResult`.
   - Trạng thái lead có: `queue, active, won, lost` (0006). Lead học viên không bao giờ ở `queue` (có CHECK), còn lead B2B `queue` là lead mở chưa giao ai.
   - Vì yêu cầu nói "pipeline nào cũng được", dùng `IN ('queue','active')` là **đúng hơn** chỉ `'active'`.
4. **Nhận khách cũ:** không lộ dữ liệu sang tổ chức khác.
   - Tra cứu có lọc `c.organization_id = conv.organization_id`, bỏ qua khách đã lưu trữ.
   - UPDATE có điều kiện `contact_id IS NULL`, và `linkStatements` dùng `COALESCE` khi không có `contactId` gửi lên, nên không ghi đè khách đã gắn.
   - Lỗi phân quyền ở H1 và việc ghi nhầm SĐT ở M7 là hai vấn đề riêng.
5. **Giao hội thoại và Lark:** đúng.
   - `skipPrivateNotice` tắt tin riêng của việc giao. Chỉ còn 1 tin riêng có mã lead, và tin nhóm vẫn giữ.
   - Có test kiểm tra đúng 1 lệnh có `openId`.
6. **230013:** đúng như đã nói ở L3.
   - Lệnh được đánh dấu lỗi cuối cùng ngay lần đầu (`final=true`).
   - `lark_link_status='error'` nằm trong CHECK. Bảng không có cột lưu lý do, nên chỉ đổi trạng thái là đúng yêu cầu.
7. **Đại từ và khớp theo giá:** xem M1 và M2. Số tiền 0 và "miễn phí" không khớp nhầm theo giá. Rủi ro còn lại nằm ở khớp theo tên và trường hợp nhiều chương trình cùng khớp.
8. **`winLearnerLead`:** bắt buộc `product_id` đúng, có test (`admissions.test.ts:235`). Xem M4 về thứ tự deploy.

## Việc nên làm, theo thứ tự ưu tiên
1. H1: kiểm tra khách có đang bị người khác giữ không khi `createLead` nhận `contactId`.
2. M1, M2: sửa bộ lọc đại từ (giữ dấu) và khớp chương trình (chỉ nhận khi có đúng 1 kết quả).
3. M3, M7: chặn lead B2B trùng theo `contact_id`; không ghi SĐT của khách khác.
4. M6: chỉ ghi các trường thay đổi.
5. M4, M5: ghi thứ tự deploy vào phase 5.
6. L8: thêm test phân loại hai lần qua `classifyIntake`.

## Câu hỏi còn mở
- Tên dạng "Anh Thư": giữ lại (có thể lọt "anh Long") hay bỏ đi? Cần chủ dự án quyết định.
- Lead B2B có cần luật "một lead mở cho mỗi khách" như lead học viên không, hay chỉ cần cảnh báo `DUPLICATE_SUSPECTED`?

Status: DONE_WITH_CONCERNS
Summary: Phase 1 làm đúng lõi yêu cầu, migration an toàn, 82 test liên quan đều đạt. Còn 1 lỗi High (createLead nhận contactId mà không kiểm tra người giữ khách) và 7 lỗi Medium (lọc đại từ bỏ nhầm tên, khớp chương trình lỏng, lead B2B trùng, thứ tự deploy) cần sửa trước khi deploy.
