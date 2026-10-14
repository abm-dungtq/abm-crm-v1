# GoClaw: đọc ảnh khách gửi (phase 2)

Ngày 14/10/2026. Opus chạy thử, không đổi cấu hình GoClaw. Mỗi lần thử dùng một user probe riêng, phiên thử đã xoá.

## Kết quả

| Cách gửi | Kết quả |
| --- | --- |
| `POST /v1/chat/completions` với `content` dạng mảng có `image_url` | 400 `INVALID_REQUEST`: `content` phải là chuỗi. Endpoint này chỉ nhận chữ. |
| WebSocket `chat.send` với `media: [{path, filename}]` (đường dẫn file trên máy GoClaw) | GoClaw nhận ảnh. Log ghi `vision: file-ref mode, images accessible via read_image tool`. Agent `sale-tu-van` trả lời "chưa đọc được", vì nó chỉ được dùng tool `datetime`. |

## Cách GoClaw xử lý ảnh (từ mã nguồn `D:\Goclaw\source`)

- `internal/gateway/methods/chat.go`:
  - `chat.send` nhận `media` là đường dẫn file cục bộ;
  - ảnh có `media` thì không bị gộp chờ (debounce).
- `internal/agent/loop_input_media.go`. Có hai chế độ:
  - Nếu tool `read_image` có provider vision riêng, ảnh **không** gắn thẳng vào tin gửi model. Agent phải tự gọi `read_image`.
  - Nếu không có, ảnh được gắn thẳng vào tin gửi model chính.
- `internal/tools/read_image.go`:
  - GoClaw tìm provider vision theo thứ tự: `openrouter`, `gemini`, `anthropic`, `claude-cli`, `dashscope`.
  - Provider hiện có: `deepseek-flash` (opencode_go) và `dntu85` (claude_cli). Vì vậy `read_image` đang dùng **Claude CLI của tài khoản cá nhân**.
- Bridge chạy cùng máy với GoClaw, nên ghi được file ảnh tạm rồi đưa đường dẫn vào `chat.send`.

## Hệ quả cho plan

- Phase 5 đổi cách gọi. Lượt có ảnh dùng WebSocket `chat.send` với `media` là file tạm do bridge ghi. Lượt chỉ có chữ giữ `/v1/chat/completions`.
- Không còn giới hạn body 1 MiB cho ảnh, vì ảnh đi bằng đường dẫn file.
- Agent `tu-van-oa` phải được phép dùng tool `read_image`.
- Provider đọc ảnh: user chọn `deepseek-flash` (opencode_go). Xem mục dưới.

## Đổi provider đọc ảnh sang deepseek-flash (14/10/2026, user đồng ý)

- Cả 7 agent GoClaw vốn đã chạy `deepseek-flash`. Chỉ tool `read_image` còn dùng `dntu85`/`sonnet` (Claude CLI cá nhân).
- Đã đổi `read_image` sang provider `deepseek-flash`, model `deepseek-flash` bằng `PUT /v1/tools/builtin/read_image`. Bản cũ lưu ở `D:\Goclaw\backups\read_image-tool-before-deepseek-20261014.json`.
- Thử bằng agent tạm `vision-probe` (deepseek-flash, cho phép `read_image`), gửi ảnh có chữ "ABM 199000" qua `chat.send`:
  - trả lời đúng "ABM 199000" sau 11 giây;
  - log gateway ghi `read_image: calling vision provider provider=deepseek-flash model=deepseek-flash images=1`.
- Agent tạm và phiên thử đã xoá.

## Phát hiện thêm

GoClaw có Cloudflare tunnel riêng (`D:\Goclaw\cloudflare\config.yml`), với hai hostname `goclaw.ngulongyquan.com` và `goclaw.tqd.io.vn` trỏ vào `127.0.0.1:18790`. Đây là cổng API của GoClaw, không phải domain đã xác thực với Zalo OA. Domain đã xác thực vẫn là `chatbot.abmedu.vn`, vì file xác thực `zalo_verifier...html` nằm trong repo webapp cũ.
