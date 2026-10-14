---
title: Long chăm sóc học viên trong nhóm Zalo
status: in_progress
created: 2026-10-13
mode: advice (handover-ready)
contract: ../reports/brainstorm-261013-1546-zalo-group-learner-care.md
---

# Long chăm sóc học viên trong nhóm Zalo

Long là bot trên nick Zalo dùng riêng cho chatbot. Trong các nhóm học viên đã bật bot, Long trả lời ngay trong nhóm khi học viên:

- @mention nick bot,
- trả lời vào một tin Long đã gửi,
- hoặc gõ "Long ơi".

Câu trả lời trích lại tin hỏi, tag người hỏi và gọi đúng tên người đó. Agent dùng trong nhóm là `cham-soc-hoc-vien`, không chứa dữ liệu học phí hay số tài khoản. Khi Long cần người hỗ trợ, CRM chỉ gửi báo sang Lark; nhóm vẫn ở chế độ `ai`.

## Phase

| # | Phase | Người làm | Trạng thái |
| --- | --- | --- | --- |
| 1 | [Bridge: tín hiệu nhóm, trả lời có trích, danh sách thành viên](phase-01-bridge-group-signals.md) | Grok (Paseo), Opus soát | done: 76 test bridge đạt, typecheck bridge/contracts/crm đạt |
| 2 | [Worker: luật trả lời trong nhóm, migration, API](phase-02-worker-group-replies.md) | Grok (Paseo), Opus soát | done: đã soát và sửa (hạn mức/ngày chỉ bỏ qua tin trả lời có `replyTo`, quét thành viên có giãn cách và chặn chạy chồng, kiểm tên agent); crm 479 test, bridge 77 test, typecheck đạt |
| 3 | [Giao diện nhóm Zalo: công tắc, agent, người ABM](phase-03-group-settings-ui.md) | Grok (Paseo), Opus soát | done: Opus soát, sửa chữ giới thiệu và toast; typecheck, build đạt |
| 4 | [Agent `cham-soc-hoc-vien` và bộ kiến thức](phase-04-learner-care-agent.md) | Opus; user duyệt KB | done: agent đã tạo, KB nạp, 15 ca thử đạt, user duyệt KB ngày 13/10 |
| 5 | [Deploy và thí điểm một nhóm](phase-05-deploy-pilot.md) | Opus; user đánh dấu người ABM | in_progress: 13/10 17:30 đã sao lưu D1 (`exports/abm-crm-eval-before-0019-20261013-1725.sql`), áp 0019, deploy Worker `8102bafd`, khởi động lại bridge; nhóm đầu có 7 thành viên đủ tên. Chờ user đánh dấu người ABM và bật một nhóm thí điểm |

Thứ tự phụ thuộc:

- Phase 1 sửa `packages/contracts`, phase 2 dùng lại các contract đó.
- Phase 3 dùng API của phase 2.
- Phase 4 làm song song với phase 1–3 vì nằm ngoài repo.
- Phase 5 chỉ làm sau khi phase 1–4 xong.

## Quyết định đã chốt (không đổi khi thực thi)

- **Khi nào trả lời:**
  - Tín hiệu là @mention nick bot (`mentions[].uid === ownId`), trả lời vào tin của bot (`quote.ownerId === ownId`), hoặc chữ "Long ơi" (không phân biệt hoa thường).
  - Mention kiểu @all không tính.
- **Không giới hạn số tin trong nhóm.** Chỉ giữ độ trễ ngẫu nhiên sẵn có của bridge trước khi gửi.
- **Một nhóm là một phiên GoClaw.** Mỗi tin gửi GoClaw có tiền tố tên nhóm và tên người gửi. Mỗi tin kích hoạt chạy một lượt riêng, không gộp nhiều tin vào một lượt.
- **Người ABM:**
  - Danh sách người ABM lưu theo tài khoản Zalo, áp cho mọi nhóm của tài khoản đó.
  - Tin của người ABM không kích hoạt Long.
  - Khi người ABM nhắn trong nhóm, các lượt trả lời đang chờ của nhóm bị huỷ.
  - Câu trả lời của Long bị bỏ nếu người ABM đã nhắn sau tin hỏi.
- **Có người gõ tay bằng nick bot trong nhóm:** Long tạm im 30 phút ở nhóm đó. Nhóm không chuyển sang `human`.
- **HANDOFF trong nhóm:** chỉ báo Lark, không đổi chế độ hội thoại. Trả lời lỗi hoặc quá hạn ở nhóm cũng chỉ báo Lark.
- **Công tắc bot cho từng nhóm** mặc định tắt. Agent mặc định của nhóm là `cham-soc-hoc-vien`. Admin đổi được agent cho từng nhóm.
- **Không đổi hành vi chat 1-1.**

## Ràng buộc cho người thực thi (Grok)

- Không commit, push, deploy.
- Không chạy `wrangler` với `--remote`, không đụng D1 remote.
- Không bật dev server, không tạo file wrangler tạm.
- Không sửa file ngoài danh sách của phase.
- Không in secret, cookie hay token.
- Viết báo cáo vào `plans/reports/grok-261013-<phase-slug>.md`. Cuối báo cáo ghi `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`.

## Tiêu chí nghiệm thu toàn kế hoạch

Lấy từ hợp đồng brainstorm, mục "Tiêu chí nghiệm thu". Phase 5 kiểm từng mục trên nhóm thí điểm.
