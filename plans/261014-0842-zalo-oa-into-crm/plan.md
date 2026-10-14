---
title: Đưa chatbot Zalo OA từ Webapp-Chatbot vào CRM
status: pending
created: 2026-10-14
mode: advice (handover-ready)
contract: ../reports/brainstorm-261014-0842-zalo-oa-into-crm.md
---

# Đưa chatbot Zalo OA từ Webapp-Chatbot vào CRM

Khách nhắn Zalo OA của ABM thì tin vào Inbox của CRM. Agent GoClaw `tu-van-oa` trả lời, mang nội dung agent OA cũ và giữ chính sách xác nhận đăng ký 199k (có đọc ảnh biên lai và code kiểm câu xác nhận). Nhân viên trả lời từ CRM. Webapp-Chatbot cũ thôi xử lý OA. Lịch sử chat OA cũ được nhập vào CRM.

**Cài đặt trong app Zalo OA giữ nguyên.** VPS `chatbot.abmedu.vn` (Caddy) chuyển tiếp hai đường dẫn sang Worker CRM:

- `/webhooks/zalo` → `/api/channels/zalo-oa/webhook`
- `/api/zalo/oauth/callback` → `/api/channels/zalo-oa/oauth/callback`

```text
Zalo ──webhook──> chatbot.abmedu.vn (Caddy, VPS) ──reverse_proxy──> Worker abm-crm-eval
                                                                     │ ghi message, xếp run_completion
                                         bridge trên PC <── claim ───┘
                                         (tải ảnh zdn.vn → GoClaw tu-van-oa)
                                                                     │ kết quả → guard 199k → send_zalo_oa
Zalo <── openapi.zalo.me/v3.0/oa/message/cs ── Worker (target worker) ┘
```

## Phase

| # | Phase | Người làm | Phụ thuộc | Trạng thái |
| --- | --- | --- | --- | --- |
| 1 | [VPS: quyền vào, kiểm kê, sao lưu, lấy nội dung agent](phase-01-vps-inventory-backup.md) | Opus | user thêm SSH public key | done: SSH chạy, DB đã sao lưu, nội dung agent đã xuất, đọc được 3 secret ([kiểm kê](../reports/vps-inventory-261014.md)) |
| 2 | [GoClaw có đọc ảnh qua chat completions không](phase-02-goclaw-vision-spike.md) | Opus | không | done: chat completions chỉ nhận chữ; WebSocket `chat.send` nhận ảnh qua tool `read_image`, provider đọc ảnh là `deepseek-flash` và đã đọc đúng ảnh thử ([báo cáo](../reports/opus-261014-goclaw-vision.md)) |
| 3 | [Contracts và migration 0020 kênh `zalo_oa`](phase-03-contracts-migration.md) | Grok, Opus soát và chạy thử trên bản sao D1 | 1 | done (Grok, 482 test đạt). Chạy thử 0020 bản cuối trên bản sao D1 remote ngày 14/10 (bọc trong transaction như D1, thêm 1 dòng `zalo_staff_member` giả): số dòng 5 bảng giữ nguyên, `foreign_key_check` rỗng |
| 4 | [Worker: webhook, OAuth, làm mới token, gửi tin, guard 199k](phase-04-worker-oa-channel.md) | Grok, Opus soát | 3 | done (Grok, 502 test đạt); đang soát code ([báo cáo](../reports/grok-261014-zalo-oa-worker.md)) |
| 5 | [Bridge: đưa ảnh vào lượt GoClaw](phase-05-bridge-images.md) | Grok, Opus soát | 2, 3 | done (Grok, 93 test đạt; Task 5.0 Opus) |
| 6 | [Giao diện: kết nối OA, nhãn kênh, công tắc 199k](phase-06-web-ui.md) | Grok, Opus soát | 4 | done (Grok, 502 test đạt, build đạt; chưa bấm thử trên trình duyệt) ([báo cáo](../reports/grok-261014-zalo-oa-ui.md)) |
| 7 | [Agent GoClaw `tu-van-oa`](phase-07-goclaw-agent.md) | Opus | 1, 2 | done: agent tạo xong, 7/7 ca 199k và 71 ca v8 đạt (chờ chạy lại với guard CRM) |
| 8 | [Nhập lịch sử chat OA cũ](phase-08-history-import.md) | Opus | 1, 3 | script sẵn sàng (`build-import.mjs`, ngoài repo). Chạy thử trên bản sao D1 + 0020: 47 hội thoại, 507 tin, 0 lệnh gửi, không lỗi khoá ngoại, chạy lại không nhân đôi. Nhập thật sau khi chuyển webhook, từ bản sao lưu VPS mới nhất |
| 9 | [Chuyển sang CRM và theo dõi](phase-09-cutover.md) | Opus | 1–8 | pending |

Phase 1 và 2 tìm ra các dữ kiện mà phase sau cần. Phase 4, 5, 6 sửa file khác nhau. Phase 7 nằm ngoài repo, nên có thể làm song song với 3–6.

## Quyết định đã chốt

- Phương án A. Caddy chỉ chuyển tiếp đúng hai đường dẫn ở trên. Mọi đường dẫn khác vẫn vào webapp cũ.
- Thêm kênh mới `zalo_oa` vào `channel_account.channel` (dựng lại bảng), và lệnh mới `send_zalo_oa` vào `channel_command.kind` (dựng lại bảng). Không dồn OA vào kênh `zalo` của nick cá nhân, vì bridge coi mọi tài khoản `zalo` là nick cá nhân của nó.
- Token OAuth v4 lưu trong D1, mã hoá AES-GCM bằng secret `ZALO_OA_TOKEN_KEY`. App ID, App Secret và OA Secret Key lưu ở Worker secret. Không lưu trong repo, không in ra.
- Kết nối OAuth lại từ CRM, không chép token từ DB cũ. Refresh token chỉ dùng được một lần, nên hai hệ thống không được cùng giữ một token.
- Tin nhân viên gõ trong app OA tính là `staff_phone`. Hội thoại chuyển sang `human` theo ADR-009, không dùng kiểu "AI nhường 10 phút" của app cũ.
- Chính sách 199k:
  - Bật theo từng OA bằng cột `channel_account.registration_policy`.
  - Guard chép nguyên từ `assertRegistrationPolicyOutput` của app cũ. Guard chạy trong Worker, trước khi xếp lệnh gửi.
  - Guard chặn thì không gửi, ghi một ghi chú hệ thống và HANDOFF báo Lark.
- Ảnh khách gửi: bridge tải ảnh (chỉ HTTPS `*.zdn.vn`, tối đa 3 ảnh, tối đa 10 MiB mỗi ảnh), ghi ra file tạm, rồi gửi GoClaw qua WebSocket `chat.send` kèm `media`. Agent đọc ảnh bằng tool `read_image`, chạy `deepseek-flash` (opencode_go).
- Nhập lịch sử: tin và hồ sơ khách của kênh OA. Không tạo lượt bot. Đoạn cuối của lịch sử nạp vào `staff_context_pending`, để lượt GoClaw đầu tiên biết bối cảnh.

## Ràng buộc cho người thực thi (Grok)

- Không commit, push, deploy.
- Không chạy `wrangler` với `--remote`. Không đụng D1 remote, VPS hay GoClaw.
- Không bật dev server. Không in secret, token hay dữ liệu khách.
- Chỉ sửa các file có trong danh sách của phase.
- Báo cáo ghi vào `plans/reports/grok-261014-<phase-slug>.md`, cuối báo cáo có `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`.

## Tiêu chí nghiệm thu

1. Khách nhắn OA thì tin hiện trong Inbox CRM, nhãn "Zalo OA", và agent trả lời trong 1 phút.
2. Ping có chữ ký của Zalo trả 200. Chữ ký sai trả 401.
3. Nhân viên gửi từ CRM thì khách nhận được. Nhân viên gõ trong app OA thì hội thoại chuyển `human`, bot không trả lời trùng.
4. Token tự làm mới, không cần dán tay.
5. Khách gửi biên lai 199k hợp lệ ở OA đã bật chính sách thì bot xác nhận đúng tên chương trình và đúng link nhóm. Câu xác nhận sai dạng bị chặn, không gửi.
6. Lịch sử chat OA cũ hiện trong CRM.
7. Webapp cũ không gửi thêm tin OA nào sau khi chuyển.
8. Đường lùi: gỡ hai khối Caddy và bật lại kênh OA ở webapp cũ.

## Failure Protocol (áp cho mọi phase)

Mỗi phase file có khối Failure Protocol riêng. Trong dự án này, người giám sát là **Opus**, không dùng `kongming`: bước Verify nào sai thì DỪNG, báo lại cho Opus kèm bằng chứng.
