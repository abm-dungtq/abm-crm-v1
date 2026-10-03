# Cấu trúc repository

Repository dùng pnpm workspace cho `apps/*`, `packages/*` và `poc/*`. Các đường dẫn code dưới đây là ranh giới dự kiến; phase bootstrap chưa tạo ứng dụng hay package thực thi.

| Đường dẫn | Trách nhiệm |
| --- | --- |
| `apps/web` | React PWA dành cho người dùng CRM. |
| `apps/api` | Hono Worker trên Cloudflare, cung cấp REST và MCP. |
| `packages/core` | Domain, command/query, policy, approval và audit dùng chung. |
| `packages/contracts` | Zod schema, scope và risk level cho mỗi command. |
| `poc/*` | Thử nghiệm foundation; xóa sau MVP0 khi bằng chứng đã được lưu trong tài liệu. |
| `docs/` | Yêu cầu sản phẩm, kiến trúc, ADR, security và integrations. |
| `plans/` | Kế hoạch thực thi, phase và báo cáo xác minh. |

MCP schema sinh từ `packages/contracts`; không viết validator thứ hai. UI, REST và MCP dùng chung hợp đồng command để giữ permission và validation nhất quán.

`docs/source-package/` chứa bản bàn giao nguồn cùng `manifest.json`. Không chỉnh sửa bản nguồn: bổ sung quyết định và thiết kế ở thư mục sở hữu trong `docs/`.

Root `package.json` cố định phiên bản pnpm và cung cấp `pnpm test`, `pnpm typecheck` để chạy script tương ứng của các package. Dùng Node >=22, pnpm đúng phiên bản trong `packageManager`, rồi chạy `pnpm install`; bootstrap chưa có package con nên chưa có test ứng dụng.

Xem [quy ước lập trình](coding-conventions.md) và [mục lục tài liệu](../README.md).
