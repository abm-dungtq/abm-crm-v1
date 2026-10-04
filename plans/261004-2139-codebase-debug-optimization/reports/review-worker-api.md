# Review Worker API và contracts

Ngày: 2026-10-04. Phạm vi: `apps/crm/src/worker/**`, `apps/crm/migrations/**`, `apps/crm/test/**`, `packages/contracts/**`, đối chiếu `docs/security/permission-matrix-v1.md` và `docs/security/action-risk-matrix-v1.md`.

Chỉ đọc code và test. Không sửa code, không chạy lại test. Checkpoint ghi `pnpm -F @abm/crm test` đã 202/202 lúc khoảng 16:40 cùng ngày; báo cáo này không đổi nguồn nên không chạy lại suite đó.

Mỗi mục dưới đây đã được đọc tại chỗ gọi và test liên quan. Trạng thái `CONFIRMED` nghĩa là luồng trong code chắc chắn làm điều đó. `PLAUSIBLE` nghĩa là cửa sổ lỗi có thật nhưng cần hai request chồng nhau mới xảy ra.

## Tóm tắt

Có 4 mục **high**, 7 mục **medium**, 3 mục **low**. Lệnh ghi (optimistic version, idempotency trên web, kill switch chặn ghi của bot, duyệt Won/Lost) được dựng đúng hướng. Lỗi nặng nhất là bảng điều hành đọc ngược kill switch, KPI dashboard tính trên tối đa 500 lead mà không báo cắt, và tìm kiếm kéo cả phạm vi vào Worker rồi mới lọc.

## Bảng phát hiện

| # | Mức | Trạng thái | Vị trí | Việc xảy ra |
|---|---|---|---|---|
| 1 | high | CONFIRMED | `apps/crm/src/worker/overview.ts:58` và `:159` | Bảng điều hành báo bot được ghi khi bot đang bị khóa, và ngược lại |
| 2 | high | CONFIRMED | `apps/crm/src/worker/queries.ts:105` và `:169` | KPI `/api/dashboard` chỉ tính 500 lead mới cập nhật, không báo đã cắt |
| 3 | high | CONFIRMED | `apps/crm/src/worker/queries.ts:105` | Tìm kiếm bỏ `LIMIT`, kéo mọi lead trong phạm vi kèm SĐT/email đã chuẩn hóa |
| 4 | high | CONFIRMED | `apps/crm/src/worker/commands.ts:239` | Tạo lead đọc toàn bộ bảng `account` của tổ chức vào bộ nhớ rồi mới so tên |
| 5 | medium | CONFIRMED | `apps/crm/src/worker/overview.ts:66` và `:146` | Một phần số của `/api/overview` đếm trên mẫu tối đa 1000 dòng, trong khi KPI đếm bằng SQL |
| 6 | medium | CONFIRMED | `apps/crm/src/worker/queries.ts:131` và `commands.ts:175` | Sau khi chuyển owner, sale cũ vẫn thấy tên khách qua việc đã hoàn thành |
| 7 | medium | CONFIRMED | `apps/crm/src/worker/queries.ts:241` | Audit khóa user, mật khẩu tạm, kill switch được ghi nhưng API không đọc lại được |
| 8 | medium | CONFIRMED | `apps/crm/src/worker/queries.ts:311` và `mcp-tools.ts:188` | Bot của Leader/Head/BGĐ/Admin nhận cả audit khi xem chi tiết lead |
| 9 | medium | CONFIRMED | `apps/crm/src/worker/auth-routes.ts:61` | Khóa đăng nhập lộ việc email tồn tại, và có thể khóa lặp một tài khoản |
| 10 | medium | CONFIRMED | `apps/crm/migrations/0001_init.sql:130` | Thiếu index cho các câu đang quét bảng khi dữ liệu lớn |
| 11 | medium | PLAUSIBLE | `apps/crm/src/worker/approval-notify.ts:44` | Hai lần gửi Lark chồng nhau có thể gửi trùng một tin duyệt |
| 12 | low | CONFIRMED | `apps/crm/src/worker/mcp-tools.ts:110` | Replay 5 phút của bot không kiểm tra lại quyền xem lead |
| 13 | low | CONFIRMED | `apps/crm/src/worker/commands.ts:266` | Báo trùng lead ngoài phạm vi vẫn tiết lộ trường nào đã khớp |
| 14 | low | CONFIRMED | `apps/crm/src/worker/commands.ts:109` | Cờ `agentNeedsApproval` trên contract không được code đọc |

## Chi tiết

### 1. Kill switch hiển thị ngược — high, CONFIRMED

`agent_kill_switch.enabled = 1` nghĩa là **đang khóa ghi**. `commands.ts:77` coi bot được ghi khi `COALESCE(MAX(enabled), 0) = 0`. Test `kill switch blocks every bot write` trong `apps/crm/test/agent-foundation.test.ts` đặt `enabled = 1` rồi kỳ vọng lệnh ghi của bot bị từ chối. `queries.ts:410` cũng đọc đúng: `= 1 AS agentKillSwitch`.

`overview.ts:58` lấy chính giá trị `enabled` và đặt tên `open`. `overview.ts:159` gán `agentWritesOpen: bot?.open === 1`. Màn hình `apps/crm/src/web/pages/overview.tsx:123` hiện "Bot được ghi" khi cờ này true.

Kịch bản: migration cài `enabled = 0` (bot được ghi). BGĐ mở tổng quan và thấy "Bot đang khóa ghi". Admin bật khóa trong màn quản trị (`admin-routes.ts:312`, `enabled = 1` chặn ghi thật) thì tổng quan đổi thành "Bot được ghi". Người vận hành nhìn nhầm trạng thái công tắc an toàn.

Đề xuất sửa: đặt `agentWritesOpen` khi `enabled = 0`, cùng nghĩa với `AGENT_WRITES_OPEN` trong `commands.ts`. Thêm một test: `enabled = 0` thì `agentWritesOpen === true`, `enabled = 1` thì `false`.

### 2. KPI dashboard cắt ngầm ở 500 lead — high, CONFIRMED

`listLeads` (`queries.ts:105`) thêm `LIMIT 500` khi không có từ khóa, sắp `updated_at DESC`. `dashboard()` (`queries.ts:169`) lấy đúng danh sách đó rồi đếm pipeline, Won/Lost trong tháng, quá hạn, SLA và bảng theo sale trong JavaScript (`queries.ts:174-210`). Response không có cờ đã cắt.

Kịch bản: tổ chức có hơn 500 lead. Lead Won tháng này nhưng không nằm trong 500 dòng vừa sửa sẽ biến mất khỏi `wonCount` và `wonValue`. Pipeline và số hàng chờ cũng thiếu. Sale ít lead thì chưa thấy; Admin, BGĐ và trưởng phòng thấy số sai mà không có dấu hiệu.

`/api/overview` đã đếm KPI bằng `GROUP BY` và có `truncated`. Dashboard không làm vậy.

Đề xuất sửa: đếm KPI bằng SQL trong phạm vi `leadScope`, giống `overview.ts:44-45`. Giữ `LIMIT` cho danh sách cần chú ý, và trả `truncated` nếu danh sách bị cắt.

### 3. Tìm kiếm không giới hạn — high, CONFIRMED

Khi có `q`, `queries.ts:105` bỏ `LIMIT`. Comment ở dòng 99 nói lọc tiếng Việt trong Worker vì `lower()` của SQLite chỉ đúng với ASCII. Câu SQL kèm subquery `group_concat` mọi `contact_point` của lead (`queries.ts:102`). `listAccounts` làm cùng kiểu khi có `q` (`queries.ts:354`: hết `LIMIT 300`). `/api/search` gọi cả hai (`queries.ts:393`).

Kịch bản: BGĐ gõ 2 ký tự. Worker đọc mọi lead của công ty, kèm số điện thoại và email đã chuẩn hóa, rồi mới `slice(0, 500)`. Trên gói free, CPU mỗi request khoảng 10 ms (ghi trong `password.ts:2-3`). Request dễ vượt trần và trả 500 "Lỗi hệ thống".

Đề xuất sửa: luôn `LIMIT` ở SQL trước khi đưa sang Worker; với ô tìm kiếm, giới hạn một trang nhỏ (vài chục dòng) hoặc thêm cột đã fold để lọc trong SQL. Không kéo `contact_point` của lead không nằm trong trang kết quả.

### 4. Tạo lead đọc cả bảng account — high, CONFIRMED

`commands.ts:239-241`: nếu có tên công ty, câu `SELECT id, name FROM account WHERE organization_id = ?` không `LIMIT`, rồi so `foldText` trong JavaScript. Bảng `account` không có index `organization_id` (chỉ có unique một phần trên mã số thuế, `0001_init.sql:63`).

Kịch bản: mỗi lần tạo lead có tên công ty, Worker tải mọi account của tổ chức. Dữ liệu càng lớn, tạo lead càng dễ đụng trần CPU. Câu trùng SĐT/email/MST phía dưới có `LIMIT 10` (`commands.ts:255`) nên phần đó ổn.

Đề xuất sửa: lưu sẵn tên đã fold (cột hoặc bảng tra), tìm bằng `=` thay vì tải cả bảng. Giữ kiểm tra MST theo unique index hiện có.

### 5. Overview trộn số đầy đủ và số trên mẫu — medium, CONFIRMED

KPI Won/Lost/pipeline của overview lấy từ `GROUP BY` (`overview.ts:44`) nên đúng. Các số sau lấy từ tối đa 1000 lead (`overview.ts:47`, `LEAD_LIMIT`):

- `slaBreaches` (`overview.ts:146`)
- `atRisk` trên mỗi cột (`overview.ts:97`)
- ma trận phòng/nhóm và khối lượng theo người (`overview.ts:111-134`)

`overview.ts:66` còn `SELECT` mọi lead `active` (id và phòng) không `LIMIT`, chỉ để map phòng, trong khi ma trận vẫn đếm trên mẫu 1000.

Kịch bản: quá 1000 lead trong kỳ, ô KPI đúng, heatmap và "quá hạn SLA" nhỏ hơn thực tế. Test `matrix rows add up to the open leads` chỉ chạy trên seed nhỏ nên không thấy.

Đề xuất sửa: đếm ma trận, SLA và workload bằng SQL. Giữ 1000 dòng chỉ cho thẻ kanban, nơi đã có `truncated`.

### 6. Việc cũ còn lộ tên khách sau khi đổi owner — medium, CONFIRMED

`applyOwnerChange` (`commands.ts:175-177`) chỉ đổi `assignee` của **next action** đang mở. Task đã `completed` giữ người được giao cũ.

`taskScope` của sale là `tk.assignee_user_id = ?` (`queries.ts:131-133`), không gắn `leadScope`. `listTasks` trả `contact_name` và `account_name` (`queries.ts:145-163`).

Kịch bản: sale A hoàn thành việc trên lead của mình. Leader chuyển lead sang sale B. A gọi `GET /api/tasks?status=completed` và vẫn thấy mã lead, tên khách, tên công ty. A mở chi tiết lead thì 404 vì `leadScope` không còn cho xem. Ma trận quyền: sale chỉ xem khách own/assigned.

Việc mở phụ cũng không được chuyển (chỉ next action được chuyển). Với dữ liệu hiện tại mỗi lead một task mở nên nhánh này chưa có dữ liệu seed, nhưng cùng một lỗ hổng nếu sau này có task mở thứ hai.

Đề xuất sửa: khi đổi owner, chuyển mọi task `open` của lead. Với task `completed`, chỉ trả tên khách khi `canSeeLead` còn đúng; nếu không, trả việc mà không kèm tên khách.

### 7. Audit quản trị ghi vào bảng nhưng không đọc được — medium, CONFIRMED

`AUDIT_SELECT` (`queries.ts:241`) `JOIN lead`. Dòng audit của `app_user`, `department`, `team`, `agent_kill_switch`, `outbox` không có lead nên bị loại. `listAudit` (`queries.ts:255`) và audit ngắn trên overview (`overview.ts:81`) dùng chung câu này.

Các lệnh vẫn ghi audit: khóa/mở user, cấp mật khẩu tạm, đổi kill switch, thu hồi token, gửi lại Lark (`admin-routes.ts`). Mật khẩu tạm không nằm trong audit (chỉ `expiresAt`) — phần đó đúng.

Kịch bản: Admin khóa một user hoặc bật kill switch, rồi mở màn audit và không thấy dòng nào. Sự cố sau này không truy được ai đã bật công tắc.

Đề xuất sửa: một câu riêng cho audit quản trị, chỉ Admin, không trả hash mật khẩu. Giữ audit nghiệp vụ lead như hiện tại.

### 8. Bot nhận audit dù ma trận cấm — medium, CONFIRMED

Ma trận (`docs/security/permission-matrix-v1.md`, dòng agent cá nhân): Audit = none. `canReadAudit` (`queries.ts:253`) chỉ loại sale, không nhìn `actor.kind`. `leadDetail` (`queries.ts:314`) nhét audit vào chi tiết. `get_lead` của MCP trả nguyên `leadDetail` (`mcp-tools.ts:188-191`).

Kịch bản: token bot của Leader/Head/BGĐ/Admin gọi `get_lead`. Payload có `before`/`after` của audit. Overview cố tình không trả các trường này vì chúng có thể chứa SĐT hoặc email (`overview.ts:80`). Bot thì nhận đủ.

Đề xuất sửa: khi `actor.kind === 'agent'`, bỏ `audit` (và cân nhắc bỏ payload duyệt) khỏi `leadDetail`.

### 9. Khóa đăng nhập — medium, CONFIRMED

`auth-routes.ts:61-65`: email không tồn tại hoặc chưa có mật khẩu trả 401 cùng câu với mật khẩu sai. Email tồn tại và đang khóa trả **423** (`auth-routes.ts:62`). Người gọi phân biệt được email có trong hệ thống và đang bị khóa. Email không tồn tại còn trả về nhanh hơn vì không chạy PBKDF2 (`password.ts:6`, 50.000 vòng).

`recordFailure` (`auth-routes.ts:38-41`) đủ 10 lần thì khóa 5 phút và **đưa bộ đếm về 0**. Hết hạn khóa, 10 lần sai nữa là khóa tiếp. Không có giới hạn theo IP.

Kịch bản: biết email nhân viên (danh sách nội bộ) thì có thể khóa đăng nhập của người đó theo chu kỳ 10 lần sai / 5 phút, lặp cả ngày.

Đề xuất sửa: tài khoản khóa vẫn trả cùng 401 với mật khẩu sai. Thêm giới hạn theo IP hoặc làm chậm khi email không tồn tại. Giữ khóa 10 lần / 5 phút như một lớp trong cùng.

### 10. Thiếu index cho câu đang dùng — medium, CONFIRMED

Đã có index hữu ích: `lead(owner_user_id, status)`, `lead(team_id, status)`, `lead(department_id, status)`, `contact_point(type, normalized_value)`, `task(assignee_user_id, status, due_at)`, `idempotency_key(actor_user_id, key)`, unique `email` và `token_hash`.

Chưa có, trong khi code đang lọc hoặc nối bằng các cột này:

| Câu | File | Cột cần index |
|---|---|---|
| Tìm lead theo SĐT/email rồi nối `lead.contact_id` | `commands.ts:243` | `lead(contact_id)`, `lead(organization_id)` |
| Account theo lead, subquery owner | `queries.ts:344-354` | `lead(account_id)`, `account(organization_id)` |
| User theo tổ chức (tên người duyệt, admin) | `queries.ts:272`, `queries.ts:402` | `app_user(organization_id)` |
| Outbox theo `status` | `queries.ts:409`, `overview.ts:65` | `outbox(status)` |
| Audit bot theo `actor_kind, created_at` | `overview.ts:61` | `audit_log(actor_kind, created_at)` |

Trên dữ liệu demo thì chưa chậm. Trên dữ liệu thật, các câu này thành quét bảng và đội CPU free.

Đề xuất sửa: thêm index ở migration mới, không sửa migration đã áp. Không đổi schema response.

### 11. Gửi Lark có thể trùng — medium, PLAUSIBLE

`deliverApprovalDm` (`approval-notify.ts:44-49`) đọc outbox khi `status IN ('pending','failed')`, gửi Lark, rồi `UPDATE` theo id mà không kèm điều kiện trạng thái cũ. `notifyCommitted` chạy sau commit (`approval-notify.ts:91`). Admin có thể bấm gửi lại (`admin-routes.ts:336`) cùng lúc.

Kịch bản: request nền và nút gửi lại cùng thấy `pending`. Cả hai gửi tin cho Leader. Không có khóa dòng.

Đề xuất sửa: `UPDATE outbox SET status = 'sending' WHERE id = ? AND status IN ('pending','failed')` và chỉ gửi khi `meta.changes = 1`.

### 12. Replay của bot bỏ qua kiểm tra phạm vi — low, CONFIRMED

Web đi qua `replayInScope` (`commands.ts:136-143`): kết quả cũ chỉ trả lại nếu actor còn thấy lead. MCP, trong 5 phút, trả thẳng `result_json` (`mcp-tools.ts:107-110`) trước khi vào `runCommand`.

Kết quả thành công hiện chủ yếu là id và trạng thái, không phải SĐT. Rủi ro thấp. Vẫn lệch với hợp đồng idempotency của web.

Đề xuất sửa: dùng chung `replayInScope` cho nhánh MCP.

### 13. Báo trùng vẫn lộ loại trường — low, CONFIRMED

`commands.ts:266-268` giấu mã lead, stage và owner khi lead ngoài phạm vi, nhưng vẫn trả `field` (`phone`, `email`, `tax_code` hoặc `company`). Người tạo lead biết số điện thoại hoặc email đó đã có trong công ty.

Đây là chủ đích "báo có trùng, không kể chi tiết", nhưng tên trường vẫn là chi tiết. Đề xuất sửa: ngoài phạm vi thì chỉ trả một câu chung, không trả `field`.

### 14. Cờ duyệt của contract không được đọc — low, CONFIRMED

`COMMANDS.*.agentNeedsApproval` (`packages/contracts/src/index.ts:232-239`) không được `runCommand` dùng. Code tự liệt kê hai lệnh (`commands.ts:109`): `changeStage` và `assignLead`. Hai lệnh này khớp cờ và khớp ngoại lệ Admin (ma trận action-risk, user chốt 2026-10-04). `releaseLead` và `decideApproval` cũng có cờ `true` nhưng không nằm trong MCP, nên hôm nay chưa gọi được.

Đề xuất sửa: `runCommand` đọc cờ trên contract. Lệnh mới thêm vào MCP sẽ không vô tình ghi thẳng.

## Đã kiểm và không phải lỗi

Những điểm sau đã đọc và đối chiếu test. Không nên sửa trong đợt vá lỗi.

- Phạm vi lead (`scope.ts:13-29`): sale theo owner, leader theo team cộng hàng chờ của phòng, head theo phòng, BGĐ và Admin theo tổ chức. Role lạ ra `0 = 1`.
- Head và BGĐ không duyệt hộ Leader. `decideApproval` chỉ sale và leader (`contracts` dòng 239). Test `domain-commands` kỳ vọng Head/BGĐ nhận `FORBIDDEN`.
- Admin không tự đổi vai trò, không tự khóa, và batch giữ ít nhất một Admin (`admin-routes.ts`).
- Kill switch **thật sự** chặn mọi ghi của bot, kể cả Admin, và được kiểm lại trong cùng batch (`commands.ts:93` và `:115`). Chỉ phần hiển thị overview bị ngược (mục 1).
- Bot không đọc cookie. MCP từ chối mọi request có header `Origin` (`mcp-routes.ts:18`). Token chỉ lưu SHA-256.
- `AUTH_MODE` sai chính tả thì tắt cả demo lẫn mật khẩu (`actor.ts:13`, test `pasword`). `DEMO_MODE=1` chỉ khi không có `AUTH_MODE`, đúng ADR-006. Không ghi thành lỗi; production phải đặt `AUTH_MODE=password`.
- Đổi mật khẩu thu hồi mọi session khác và không ghi mật khẩu vào audit (`auth-routes.ts:117-121`).
- Mật khẩu tạm 1 vòng lặp là quyết định đã ghi trong `password.ts:7-9` (khoảng 70 bit, tránh đốt CPU khi nhập nhiều user). Không đảo quyết định đó.
- Sale tự chốt Won trên web là hành vi test đang khóa (`domain-commands`: sale thiếu `wonValue` thì `VALIDATION_FAILED`, không phải `FORBIDDEN`). Duyệt của bot mới bắt Leader.
- Cookie phiên: HttpOnly, Secure, SameSite=Lax, chỉ lưu hash. `originGuard` từ chối POST thiếu hoặc sai `Origin` khi đang ở chế độ mật khẩu (`session.ts:54-59`).

## Cơ hội tối ưu

Không chặn các mục lỗi phía trên. Xếp theo lợi ích khi dữ liệu lớn.

1. **Cột tên đã fold** cho account, lead và contact. Hết phải tải cả bảng để so tiếng Việt. Lợi ích cao, công sức trung bình, đụng mục 3 và 4.
2. **Dọn `idempotency_key` và `user_session`.** Cả hai chỉ tăng. Xóa key cũ hơn vài ngày và session đã hết hạn hoặc đã thu hồi. Lợi ích trung bình, công sức thấp, rủi ro thấp nếu giữ cửa sổ replay 5 phút của bot.
3. **Lịch nghỉ Việt Nam trong `packages/contracts/src/working-time.ts`.** File đang nói rõ bản đánh giá chỉ trừ thứ Bảy và Chủ nhật. SLA liên hệ đầu và giờ được nhả lead sẽ sai vào ngày lễ. Cần danh sách nghỉ được duyệt trước khi làm. Công sức trung bình.
4. **Một token Lark cho cả vòng gửi.** `sendText` (`lark.ts:38`) xin tenant token từng người nhận. Vài Leader thì chưa đáng kể. Nên xin một lần mỗi đợt gửi.
5. **`listApprovals` tải mọi user của tổ chức** (`queries.ts:272`) chỉ để map tên. Nối `app_user` theo id trong payload, hoặc chỉ SELECT các id xuất hiện trong trang. Lợi ích thấp cho đến khi công ty đông nhân sự.
6. **Hoạt động trên chi tiết lead không `LIMIT`** (`queries.ts:311`). Một lead nhiều năm ghi chú sẽ trả hết trong một response. Nên phân trang, mới nhất trước, giống account detail đã `LIMIT 60` (`queries.ts:375`).
7. **Đếm admin overview không gắn `organization_id`** (`queries.ts:408`): `lead`, `audit_log`, `outbox`, `approval`. Đúng với một tổ chức trên một D1. Khi có tổ chức thứ hai trong cùng database thì Admin thấy số của tổ chức kia. Gắn scope khi nào sản phẩm đa tổ chức.
8. **Tạo lead cùng MST song song** (`commands.ts:286-293`) có thể đụng unique `account_tax_code` và trả 500 thay vì lỗi trùng dễ hiểu. Hiếm (hai request cùng lúc, MST mới). Bắt lỗi unique và trả 409.

## Việc còn lại

- Phase này không sửa code. Các mục high/medium ở trên là đầu vào cho phase sửa lỗi và phase phương án tối ưu.
- Chưa chạy lại `pnpm -F @abm/crm test`, `typecheck`, `build` vì không có diff nguồn.
- `git status` vẫn còn các file dở sẵn của user (`docs/README.md`, `docs/guides/lark-crm-e2e-test.md`, `poc/**`, `plans/261004-1457-crm-bot-gateway/**`, `plans/journals/**`, `.claude/**`). Đợt này không đụng các file đó.
