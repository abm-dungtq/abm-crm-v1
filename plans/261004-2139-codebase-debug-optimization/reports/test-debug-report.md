# Báo cáo test và debug CRM

Thực hiện ngày 04/10/2026, khoảng 21:43–21:49, múi giờ Asia/Saigon. Phạm vi là phase 01: chạy kiểm tra, đọc mã và ghi báo cáo; không sửa nguồn, test hay trạng thái plan.

## Kết quả kiểm tra

Các lệnh dưới chạy bằng PowerShell từ `D:/TQD/CRM`. Test dùng D1 cô lập của Cloudflare Vitest, với `remoteBindings: false` trong `apps/crm/vitest.config.ts:8`; không thao tác dữ liệu vận hành, gọi remote D1, GoClaw hay Lark thật.

| Lệnh | Exit code | Kết quả và thời gian |
| --- | --- | --- |
| `pnpm -F @abm/crm test` | 0 | 14 file, 202/202 test đạt, 11,92 giây. Tổng thời gian thực thi test cộng trên các file là 28,54 giây. |
| `pnpm -F @abm/crm typecheck` | 0 | Worker và web đều đạt, khoảng 2,38 giây theo tiến trình lệnh. |
| `pnpm -F @abm/crm build` | 0 | Vite hoàn tất trong 2,82 giây; có cảnh báo kích thước chunk. |
| `pnpm -r test` | 0 | CRM 202/202; hai package PoC mỗi package 8/8, tổng 218/218. Thời gian Vitest của CRM là 11,20 giây, các PoC là 1,57 và 2,13 giây. Không chạy test nào cho contracts vì package không có script test. |
| `pnpm -F @abm/contracts typecheck` | 0 | Contracts đạt, khoảng 1,09 giây theo tiến trình lệnh. |
| `pnpm -F @abm/crm exec vitest run test/auth-login.test.ts --reporter verbose --no-file-parallelism` | 0 | 15/15 test đạt, 3,35 giây. Chạy riêng để đo thời gian từng test đăng nhập. |

Không có coverage: không tìm thấy provider `@vitest/coverage-v8` hoặc `@vitest/coverage-istanbul` trong dependency đã cài, không có script coverage trong package CRM. Không cài thêm; không suy ra tỷ lệ coverage từ số test. Logic contracts có kiểm tra tích hợp qua test CRM, đặc biệt `domain-working-time.test.ts`, nhưng package contracts không có bộ test độc lập.

## Lỗi đã xác nhận

### Medium: MCP replay trả thành công dù kill switch vừa bật

- Vị trí: `apps/crm/src/worker/mcp-tools.ts:110`. Nhánh này trả trực tiếp `recent.result_json` trong 5 phút, trước lời gọi `runCommand` tại dòng 112. Pipeline kiểm tra kill switch ở `apps/crm/src/worker/commands.ts:93` chỉ được chạy khi đi tiếp vào command.
- Tái hiện trên D1 test: tạo token tạm cho Admin; gọi `/api/mcp` với tool `log_activity`, args `{lead_code: 'L-0004', type: 'note', summary: 'Local replay probe'}`; lần đầu thành công. Bật kill switch trong D1 test bằng `UPDATE agent_kill_switch SET enabled = 1 WHERE id = 1`, rồi gọi lại cùng tool và args ngay sau đó.
- Kỳ vọng: trả lỗi `KILL_SWITCH_ON`, thống nhất với command pipeline hiện tại. Thực tế: trả kết quả thành công đã lưu, trường `data.code` là `undefined`; assertion kỳ vọng `KILL_SWITCH_ON` thất bại.
- Tác động: kết quả MCP gây hiểu sai trạng thái khóa ghi hiện tại. Nhánh này không ghi lại activity, nên bằng chứng không chứng minh có ghi dữ liệu mới khi khóa đang bật. Không xếp high hoặc critical và không kết luận lộ dữ liệu ngoài phạm vi.
- Hướng sửa: cho replay MCP đi qua kiểm tra quyền và kill switch của pipeline hiện có, vẫn giữ request hash và cơ chế chống ghi trùng. Thêm test hồi quy bật kill switch giữa lần gọi đầu và replay.

### Low: build tải một chunk JavaScript lớn

- Vị trí cấu hình và nguyên nhân: `apps/crm/src/web/router.tsx:7` đến các import page tiếp theo tải tĩnh toàn bộ trang; `apps/crm/vite.config.ts:7` không cấu hình chia chunk. Build tạo `dist/assets/index-zZyLkkYZ.js` dung lượng 527,77 kB, gzip 156,91 kB và cảnh báo vượt 500 kB.
- Tái hiện: chạy `pnpm -F @abm/crm build`. Đây là cảnh báo, không phải lỗi build; chưa đo ảnh hưởng thực tế lên tốc độ tải trang.
- Hướng xử lý tùy chọn: xem xét tải page theo nhu cầu và đo lại bundle/tốc độ tải ở phase đề xuất tối ưu. Không tăng ngưỡng cảnh báo chỉ để làm mất cảnh báo.

## Test tạm và giới hạn kiểm chứng

Test tạm chỉ dùng migration, seed demo và request nội bộ `app.fetch` của môi trường D1 test. Không ghi file test vào repo và không gọi dịch vụ thật.

1. Lệnh `pnpm -F @abm/crm exec vitest run --config C:/Users/ABM/AppData/Local/Temp/crm-test-debug-ctx-a382e0917acd/vitest.config.mjs` exit 1 trước khi chạy test. Cloudflare plugin ghép sai đường dẫn giữa hai ổ đĩa thành `D:/C:/Users/.../replay-check.test.ts`; đây là lỗi tooling cho test tạm, không phải lỗi sản phẩm.
2. Coordinator đã duyệt chuyển đúng hai file tạm sang cùng ổ D và chạy lại một lần. Lệnh `pnpm -F @abm/crm exec vitest run --config D:/TQD/crm-test-debug-ctx-a382e0917acd/vitest.config.mjs` exit 1, chạy 2 test trong 1,68 giây, cả hai assertion đều đỏ.
3. Test thứ nhất xác nhận lỗi kill switch nêu trên. Test thứ hai đổi Admin thành director rồi kỳ vọng `log_activity` bị `FORBIDDEN`; kỳ vọng này sai vì `packages/contracts/src/index.ts:235` vẫn cho director thực hiện `logActivity`. Loại test thứ hai khỏi phát hiện sản phẩm, không dùng nó làm bằng chứng lỗi phân quyền.
4. Đã xóa hai file `vitest.config.mjs`, `replay-check.test.ts` và cả hai thư mục tạm trên C và D ngay sau lần chạy lại. Không để lại test tạm trong repo hoặc ngoài repo.

## Các vùng cần bổ sung test

Đây là khoảng trống kiểm chứng, không phải các lỗi đã xác nhận.

| Vùng | Bằng chứng hiện có | Tình huống còn thiếu |
| --- | --- | --- |
| `scope.ts`, `leadScope` | `commands.test.ts:42`, `security-api.test.ts:166` kiểm tra Sale, Leader, Head, BGĐ, Admin và ngoài phòng/tổ chức. | Kiểm tra trực tiếp actor thiếu team/phòng để chứng minh luôn đóng quyền; đối chiếu đổi quyền giữa tiền kiểm và batch. |
| Command ghi | Test stale version, rollback, idempotency và concurrent update ở `commands.test.ts`, `security-integrity.test.ts`, `business-rules-hardening.test.ts`. | Quyền actor bị thu hồi trong lúc command đang thực thi; cạnh tranh cùng tax code khi tạo account; cạnh tranh hai approval agent cùng loại. |
| `/api/mcp` | `mcp-gateway.test.ts` kiểm tra bearer, token revoked, user disabled, Origin, 11 tool, kill switch và replay nhanh. | Replay sau khi bật kill switch; replay sau khi đổi sang vai trò thật sự không được phép thực hiện command; payload quá 64 KiB, JSON-RPC sai cấu trúc và arguments sai kiểu. |
| Approval và outbox | `approval-notify.test.ts` có lỗi gửi, resend, không có người nhận và approval đã quyết định. | Hai resend đồng thời; nhiều Leader nhưng chỉ một người gửi thất bại; resend sau khi Leader mới liên kết từ trạng thái `no_recipient`. `approval-notify.ts:44` đọc trạng thái trước vòng gửi, chưa có test về quyền sở hữu lượt gửi. Không thực nghiệm gửi Lark trong phase này. |
| Đăng nhập mật khẩu | `auth-login.test.ts` có khóa sau 10 lần sai, khóa khi sai song song, mật khẩu tạm, đổi mật khẩu, logout, CSRF và thu hồi session. | Hết hạn session 7 ngày; login đúng đồng thời với reset/disable tài khoản; cạnh tranh giữa lần đúng và lần sai cuối cùng gây khóa. |

## Thời gian và độ ổn định

Hai lần chạy nguyên bộ CRM đều đạt 202/202, không thấy test chập chờn trong các lần quan sát này; chưa đủ bằng chứng để khẳng định không có flaky test. Lần đo riêng auth có test chậm nhất là `wrong current password on change counts toward the lock`, 314 ms; test khóa sau 10 lần sai là 275 ms và test sai song song là 255 ms. Không có test auth nào vượt 5 giây. Output mặc định không có thời gian từng test ngoài auth, nên không xếp hạng toàn suite.

## Phạm vi thay đổi và việc còn lại

File duy nhất worker tạo là `plans/261004-2139-codebase-debug-optimization/reports/test-debug-report.md`. Không sửa source/test, không stage/commit, không đổi frontmatter phase, `plan.md` hay checkpoint; không tạo journal vì task cấm ghi journal. Build tạo output bị Git bỏ qua theo lệnh kiểm tra được cho phép.

Danh sách file tracked đang thay đổi sau kiểm tra giống lúc bắt đầu: `docs/README.md`, plan bot gateway, báo cáo PoC identity và `poc/goclaw-identity/wrangler.jsonc`; worker không đụng các file này. Repo đã có nhiều file untracked của user và plan coordinator từ đầu, nên không thể diễn đạt `git status` toàn repo là chỉ có một báo cáo; cần đối chiếu với baseline của coordinator.

Phase 01 không còn blocker. Các lỗi và đề xuất test trong báo cáo chưa được sửa; coordinator quyết định phạm vi phase sửa lỗi tiếp theo. Không có phát hiện critical/high được xác nhận trong phạm vi kiểm tra này, và không suy rộng kết luận sang toàn codebase.
