# ADR-008: Sidecar Zalo ngoài Cloudflare

Trạng thái: accepted
Ngày: 2026-10-08
Cập nhật [ADR-001](adr-001-stack-cloudflare-modular-monolith.md): thêm một ngoại lệ có giới hạn cho quy tắc "toàn Cloudflare".

## Bối cảnh

CRM cần gom tin Zalo cá nhân (dưới 10 số chung của công ty) vào trang Inbox. Thư viện zca-js giữ một socket sống lâu với máy chủ Zalo; Cloudflare Worker chỉ chạy theo request nên không giữ được phiên đó. GoClaw (LLM `deepseek-flash`) đã chạy 24/7 trên một máy Windows của công ty, sau Cloudflare Tunnel. Nguồn: [brainstorm](../../plans/reports/brainstorm-261008-1421-omnichannel-inbox-goclaw.md), [plan](../../plans/261008-1430-omnichannel-inbox-goclaw/plan.md).

## Quyết định

- Thêm `apps/zalo-bridge` (Node 22, TypeScript) chạy trên máy Windows cạnh GoClaw. Sidecar giữ phiên zca-js, đẩy sự kiện tin Zalo vào Worker, nhận lệnh và thực thi.
- Sidecar chỉ kéo lệnh: long-poll `GET /api/bridge/commands`, đẩy sự kiện bằng `POST /api/bridge/events`, trả kết quả bằng `POST /api/bridge/commands/:id/result`. Mọi request `/api/bridge/*` ký HMAC-SHA256 bằng `BRIDGE_SECRET` kèm timestamp; Worker từ chối khi lệch giờ quá 300 giây. Sidecar không mở cổng nào vào máy.
- Sidecar không giữ trạng thái nghiệp vụ. Worker là nơi duy nhất ghi dữ liệu chuẩn (hội thoại, chế độ, chia việc, lead). Sidecar không tự quyết trả lời hay chuyển chế độ.
- Sidecar gọi GoClaw qua `http://127.0.0.1:18790`, không đi qua tunnel.
- Sidecar tự khởi động bằng Task Scheduler của Windows khi máy bật.

## Phương án đã xét

- Chatwoot: có sẵn inbox đa kênh nhưng cần Docker, Redis, Ruby chạy 24/7 và vẫn cần cầu nối Zalo cá nhân riêng; trùng dữ liệu với CRM. Loại.
- Vá GoClaw để thêm kênh Zalo cá nhân: phải giữ một bản fork GoClaw, trái quyết định không sửa mã GoClaw. Loại.
- Đặt bot loop trong sidecar, Worker chỉ lưu và hiển thị: nhanh nhất nhưng đưa logic nghiệp vụ ra ngoài core, trái ADR-001 (thành phần ngoài core không là nguồn dữ liệu chuẩn). Loại.
- Sidecar chỉ thực thi, Worker điều phối: chọn.

## Hệ quả

- Rủi ro điều khoản Zalo cá nhân được chấp nhận rõ ràng: zca-js dùng giao thức không chính thức, Zalo có thể đá phiên hoặc khóa số chung. Giảm thiểu bằng pilot 2 số trong 2 tuần, giới hạn tin/ngày theo tài khoản, giờ yên lặng, `send_paused` và công tắc tắt.
- Nhân viên không đăng nhập Zalo PC hay Zalo Web trên số chung; mỗi số chỉ có một điện thoại giữ và phiên của sidecar.
- Khi máy Windows tắt hoặc mất mạng, lệnh `target='bridge'` nằm chờ trong D1 và chạy khi sidecar kết nối lại; Inbox vẫn đọc được.
- Đội vận hành thêm một tiến trình Node ngoài Cloudflare: cập nhật zca-js, kiểm giấy phép thư viện trước khi cài, theo dõi máy Windows.
- `BRIDGE_SECRET` là secret của Worker và của sidecar; lộ secret thì phải xoay cả hai nơi.
