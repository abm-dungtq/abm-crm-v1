# Hướng dẫn đăng cẩm nang học tập và tải video lên cổng LMS

Tài liệu này hướng dẫn Học vụ, Admin hoặc AI agent (Claude Code trên máy trạm) chuẩn bị cẩm nang HTML, kiểm tra cấu trúc bài học, đăng lên chương trình của lớp trên CRM và gắn video ghi hình buổi học lên Cloudflare Stream.

## 1. Thiết lập một lần trên máy trạm

Mọi khóa bí mật được đọc từ thư mục `%USERPROFILE%\.abm\` (`~/.abm/`) và **không bao giờ in ra màn hình hay lưu trong git**:

1. **Token đăng bài LMS (`~/.abm/lms-publish-token`)**:
   Chạy từ thư mục `D:\TQD\CRM\apps\crm` bằng tài khoản Cloudflare có quyền truy cập D1 `abm-crm-eval`:
   ```powershell
   node scripts/issue-lms-publish-token.mjs --email <email-hoc-vu-hoac-admin>
   ```
   - Tài khoản CRM phải đang hoạt động (`active`) và có vai trò `academic` hoặc `admin`.
   - Lệnh này chỉ thu hồi các token `label = 'lms-publish'` cũ của người đó, **không đụng tới token GoClaw** (`label = 'goclaw'`), rồi ghi token mới vào `~/.abm/lms-publish-token`.
2. **Stream API Token (`~/.abm/stream-api-token`)**:
   Tạo API Token trên Cloudflare với quyền `Stream:Edit` và lưu chuỗi token (1 dòng, không khoảng trắng thừa) vào `~/.abm/stream-api-token`.
3. **Cloudflare Account ID (`~/.abm/cloudflare-account-id`)**:
   Lưu Account ID của tài khoản Cloudflare vào `~/.abm/cloudflare-account-id` (hoặc truyền qua `--account` khi tải video).

## 2. Quy ước file cẩm nang HTML (Handbook Contract)

Để hiển thị an toàn trong khung học cô lập (`abm-lms-content` + `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" allow="clipboard-write">`), file cẩm nang phải tuân thủ:

- **Một file HTML tự chứa (self-contained)**: toàn bộ CSS, JS và hình ảnh phải nhúng trực tiếp (ảnh dùng `data:` URI hoặc inline SVG). Ảnh từ domain ngoài sẽ không tải được do CSP `img-src 'self' data: blob:; connect-src 'none'`.
- **Dung lượng tối đa**: sau khi gắn script cầu nối (`BRIDGE_SCRIPT`), tổng độ dài chuỗi HTML không vượt quá `3,000,000` ký tự.
- **Cấu trúc từng phần bài học (`<section>`)**:
  - Mỗi phần học là một thẻ `<section ... id="<id>">`.
  - `id` khớp biểu thức `/^[A-Za-z0-9_-]{1,64}$/`, không trùng lặp trong toàn tài liệu, tối đa **300** phần (sau khi loại các phần trong `--skip`, mặc định bỏ qua `home`).
- **Mục lục điều hướng (`[data-target="<id>"]`)**:
  - Có thể có các nút/mục điều hướng mang thuộc tính `data-target="<id>"`.
  - Khi học viên chọn bài ở cột trái của cổng LMS, script cầu nối sẽ tự bấm (`click()`) vào phần tử `[data-target="<id>"]` tương ứng; nếu không có thì cuộn (`scrollIntoView()`) tới `<section id="<id>">`.
  - Khi học viên bấm vào phần tử `[data-target="<id>"]` bên trong cẩm nang, cầu nối gửi `postMessage({ type: 'abm-lms:section', sectionId }, '*')` ra cửa sổ cha để đồng bộ bài đang học và danh sách video.
- **Tiêu đề phần học (`title`)**:
  - Lấy từ nội dung chữ của phần tử `[data-target="<id>"]` đầu tiên (đã lọc bỏ emoji và các thẻ icon như `.n-ico`, `.ico`), nếu không có thì lấy thẻ `<h1>` hoặc `<h2>` đầu tiên bên trong `<section>`.
- **Liên kết ngoài và bộ nhớ trình duyệt**:
  - Cẩm nang có thể mở link ngoài ở tab mới (`target="_blank"`).
  - **Không phụ thuộc vào `localStorage`, `sessionStorage` hoặc `document.cookie`** vì iframe chạy ở opaque origin. Hàm `parseHandbook` sẽ trả về cảnh báo trong `warnings` và `lms-publish.mjs` sẽ in cảnh báo nếu phát hiện `localStorage` hoặc `sessionStorage`.

## 3. Quy trình đăng cẩm nang lên lớp học

Thực hiện từ thư mục `D:\TQD\CRM\apps\crm`:

### Bước 1: Tra cứu mã lớp (`classId`)
```powershell
node scripts/lms-publish.mjs --list-classes
```
Lệnh in bảng `id | lớp | khoá | có chương trình`. Chọn `id` của lớp cần đăng.

### Bước 2: Kiểm tra trước bằng `--dry-run` (bắt buộc trước khi đăng thật)
```powershell
node scripts/lms-publish.mjs `
  --file "duong-dan\cam-nang.html" `
  --groups "b1=Buổi 1;b2=Buổi 2;b3=Buổi 3;lib=Thư viện" `
  --skip "home" `
  --dry-run
```
- Lệnh chạy hoàn toàn cục bộ (không gọi mạng), kiểm tra lỗi cú pháp/trùng `id`/giới hạn 3M ký tự và in ra tiêu đề, tổng số phần cùng danh sách `sectionId — groupTitle — title`.
- Tuỳ chọn `--hide "<css selector>"` có thể dùng để ẩn thanh điều hướng nội bộ của cẩm nang nếu muốn.

### Bước 3: Đăng chính thức lên CRM
```powershell
node scripts/lms-publish.mjs `
  --class <classId> `
  --file "duong-dan\cam-nang.html" `
  --groups "b1=Buổi 1;b2=Buổi 2;b3=Buổi 3;lib=Thư viện"
```
Khi thành công, lệnh in: `Đã đăng: chương trình <programId>, phiên bản <n>, <lessons> phần, <hidden> phần bị gỡ`.

## 4. Tải video buổi học lên Cloudflare Stream và gắn vào phần học

1. **Tải file MP4 về máy**: Với bản ghi Zoom Cloud, tải file `.mp4` về máy trạm trước (link chia sẻ Zoom thường hết hạn hoặc chặn tải trực tiếp).
2. **Chạy lệnh tải video (giao thức tus 50 MiB/chunk, tự nối lại tối đa 5 lần mỗi chunk khi rớt mạng)**:
   ```powershell
   node scripts/lms-upload-video.mjs `
     --class <classId> `
     --section <sectionId> `
     --title "Buổi 1 — Phần 1: Khơi mở Năng lượng mới" `
     --file "D:\Recordings\buoi-01-phan-1.mp4"
   ```
   Video được tạo trên Stream với chế độ `requireSignedURLs = true` và tự động gắn vào phần `<sectionId>` của lớp.

## 5. Đăng lại (cập nhật phiên bản) và quản trị trên CRM

- **Đăng lại cẩm nang**: Chạy lại `lms-publish.mjs` với cùng `--class <classId>` sẽ tạo phiên bản nội dung mới (`v2`, `v3`, …) trên R2:
  - Các phần có cùng `sectionId` được giữ nguyên ID bài học, cập nhật tiêu đề/nhóm/thứ tự và **giữ nguyên toàn bộ video cùng tiến độ học viên**.
  - Các phần cũ không còn trong file HTML mới sẽ được đánh dấu ẩn (`hidden_at`), không xóa dữ liệu lịch sử hay video đã gắn.
- **Thao tác của Học vụ trên giao diện web CRM**:
  - Mở chi tiết lớp → thẻ **Chương trình học (LMS)** để xem trước nội dung, đặt **Số ngày xem lại sau buổi học cuối** (`reviewDays`, để trống = không giới hạn), sửa/xóa video từng phần, nhân bản chương trình sang lớp mới (không chép video), hoặc cấp/chặn quyền truy cập cho từng học viên.

## 6. Xử lý lỗi thường gặp (Troubleshooting)

| Mã HTTP / Lỗi | Nguyên nhân | Cách khắc phục |
|---|---|---|
| `401 Unauthorized` | Thiếu file `~/.abm/lms-publish-token`, token bị thu hồi hoặc tài khoản bị khóa. | Chạy lại `node scripts/issue-lms-publish-token.mjs --email <email>` để cấp token mới. |
| `403 Forbidden` | Tài khoản gắn với token không có vai trò `academic` hoặc `admin`. | Cấp lại token bằng email của nhân sự Học vụ hoặc Admin. |
| `404 Not Found` | `classId` không tồn tại trong tổ chức, hoặc `sectionId` chưa có trong chương trình khi gắn video. | Kiểm tra bằng `--list-classes` và đảm bảo đã chạy `lms-publish.mjs` trước khi gắn video. |
| `409 Conflict` (`KILL_SWITCH_ON` / `STALE_VERSION`) | Công tắc khóa ghi của agent đang bật trên CRM hoặc có xung đột phiên bản đồng thời. | Kiểm tra trạng thái kill-switch trên CRM hoặc chạy lại lệnh sau vài giây. |
| `422 Validation Failed` | HTML > 3.000.000 ký tự, `sectionId` sai định dạng/trùng lặp, hoặc `streamUid` không phải 32 ký tự hex. | Chạy `--dry-run` để rà lỗi cấu trúc HTML trước khi đăng. |
