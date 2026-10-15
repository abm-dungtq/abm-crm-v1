# Báo cáo Phase C: Nhân viên chọn, dán, nén, xem trước và gửi ảnh từ ô chat (Composer)

## 1. Các thay đổi đã thực hiện

### 1.1. Tầng API và kiểu dữ liệu (`apps/crm/src/web/api.ts`, `apps/crm/src/web/types.ts`, `apps/crm/src/web/inbox-format.ts`)
- Thêm kiểu `UploadedInboxMedia` (`{ key, url, mimeType, size }`) vào `apps/crm/src/web/types.ts`.
- Trong `apps/crm/src/web/api.ts`:
  - Cập nhật `request<T>` không tự gán `Content-Type: application/json` khi `init.body` là `FormData` để trình duyệt tự đính kèm boundary cho `multipart/form-data`, vẫn giữ nguyên cookie phiên và header `X-Demo-User`.
  - Thêm hàm `uploadInboxMedia(file: Blob, filename = 'image.jpg')` gửi `POST /api/inbox/media` với trường `file`.
  - Mở rộng `sendMessage(id, text, clientMessageId, attachments?)` để gửi `POST /api/inbox/conversations/:id/messages` kèm `attachments?: { key: string }[]` và cho phép `text` rỗng khi đã có ảnh.
- Thêm hàm thuần `canChannelSendImages(channel)` trong `apps/crm/src/web/inbox-format.ts` (trả về `true` cho `zalo` và `zalo_oa`, `false` cho `facebook`).

### 1.2. Nén ảnh trên trình duyệt (`apps/crm/src/web/image-compress.ts`)
- Tạo module `apps/crm/src/web/image-compress.ts` xử lý giải mã, thu phóng và nén ảnh sang JPEG trước khi tải lên.

### 1.3. Ô soạn tin nhắn `Composer` và giao diện xem trước (`apps/crm/src/web/components/inbox-thread.tsx`, `apps/crm/src/web/styles.css`)
- **Nút chọn ảnh (`+`)**:
  - Đặt nút icon `<Icon name="plus" />` với `aria-label="Thêm ảnh"` bên trái ô nhập `textarea`.
  - Mở `<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple>` ẩn; sau khi chọn sẽ xóa `value` của input để có thể chọn lại cùng một tệp.
  - Chỉ hiển thị trên kênh `zalo` và `zalo_oa`; ẩn hoàn toàn trên kênh `facebook`.
- **Dán ảnh (Ctrl+V) và kéo thả**:
  - Bắt sự kiện `onPaste` trên `textarea`: nếu clipboard có tệp ảnh thì chặn hành vi mặc định và đưa vào hàng đợi nén/tải lên; nếu chỉ dán văn bản thuần thì giữ nguyên hành vi hiện tại.
  - Hỗ trợ kéo thả tệp ảnh trực tiếp vào khung `.inbox-composer` (trạng thái `data-drag="true"`).
- **Dải xem trước (`.composer-strip`)**:
  - Hiển thị phía trên `textarea` với các ô ảnh thu nhỏ `64×64 px` (`.composer-thumb`).
  - Mỗi ảnh có nút xóa (`×`) với `aria-label="Bỏ ảnh"`, hỗ trợ bàn phím và `:focus-visible`.
  - Giới hạn tối đa 4 ảnh mỗi tin nhắn (`STAFF_IMAGE_MAX = 4`). Khi người dùng chọn/dán vượt quá 4 ảnh, hiển thị thông báo lỗi `"Chỉ được đính kèm tối đa 4 ảnh trong một tin nhắn"` qua `FormError`.
  - Hiển thị trạng thái đang tải (`.composer-spinner`, `aria-label="Đang tải ảnh"`) hoặc lỗi tải ảnh (`.composer-thumb-error`, icon cảnh báo kèm thông báo lỗi trên `FormError`).
- **Tải lên ngay và gửi tin**:
  - Mỗi ảnh vừa thêm sẽ được nén và gọi `uploadInboxMedia` ngay lập tức.
  - Nút `Gửi` bị vô hiệu hóa trong lúc còn ảnh đang tải lên (`isUploading`) hoặc đang gửi (`send.isPending`), và được bật khi có nội dung chữ hợp lệ (`<= 2000` ký tự) hoặc có ít nhất 1 ảnh đã tải lên thành công.
  - Giữ nguyên cơ chế `clientMessageId` chống gửi trùng khi thử lại: tái sử dụng `clientMessageId` nếu cả `text` và danh sách `key` ảnh không đổi; sinh `clientMessageId` mới nếu nhân viên sửa chữ hoặc thêm/bớt ảnh.
  - Hiển thị tin nhắn đang gửi tạm thời (optimistic pending message) trong danh sách tin nhắn kèm ảnh xem trước cục bộ (`previewUrl`), và tự động đồng bộ lại từ máy chủ trong `onSettled`.
- **Dọn dẹp bộ nhớ (`URL.revokeObjectURL`)**:
  - Thu hồi Object URL ngay khi bấm `Bỏ ảnh`, khi gửi thành công (`clearImages`), khicomponent `Composer` unmount (hoặc đổi hội thoại), và ngay sau khi giải mã ảnh bằng thẻ `<img>` dự phòng.

### 1.4. Kiểm thử (`apps/crm/test/web-inbox.test.ts`)
- Bổ sung 3 bài test cho `canChannelSendImages`, `fitImageDimensions` / `toJpgFilename`, và vòng lặp nén giảm chất lượng + giảm kích thước / báo lỗi giải mã của `compressImage`.

## 2. Cơ chế nén ảnh trên trình duyệt (`compressImage`)

1. **Giải mã ảnh (`decodeImageSourceInBrowser`)**:
   - Ưu tiên dùng `createImageBitmap(file)`.
   - Nếu trình duyệt không hỗ trợ hoặc `createImageBitmap` thất bại, tự động chuyển sang phương án dự phòng dùng phần tử `<img>` (`new Image()` với `URL.createObjectURL(file)` và thu hồi URL trong `close()`).
   - Nếu cả hai cách đều không đọc được ảnh (ví dụ ảnh HEIC trên Chrome hoặc tệp hỏng), ném lỗi `"Không đọc được ảnh này, hãy chọn ảnh JPG hoặc PNG"`.
2. **Thu phóng cạnh dài nhất (`fitImageDimensions`)**:
   - Nếu cạnh dài nhất lớn hơn `2048 px`, thu nhỏ theo đúng tỷ lệ khung hình về tối đa `2048 px` (không phóng to ảnh nhỏ hơn `2048 px`).
3. **Vẽ lên Canvas nền trắng và xuất JPEG**:
   - Tô toàn bộ mặt canvas bằng màu trắng đặc (`ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height)`) trước khi gọi `ctx.drawImage`, đảm bảo ảnh PNG có nền trong suốt được chuyển thành JPEG trên nền trắng.
   - Xuất `image/jpeg` qua `canvas.toBlob` bắt đầu ở mức chất lượng `0.85`, giảm dần qua `0.75` → `0.65` → `0.55`.
   - Nếu ở mức `0.55` dung lượng vẫn lớn hơn `1,000,000 bytes`, tiếp tục giảm kích thước cạnh dài đi `0.75×` mỗi bước (vẽ lại canvas ở kích thước mới và thử lại các mức chất lượng) cho tới khi kích thước tệp JPEG `<= 1,000,000 bytes`.
   - Luôn gọi `handle.close()` trong khối `finally` để giải phóng `ImageBitmap` và xóa kích thước canvas tạm.

## 3. Kết quả kiểm tra (Verify)

Thực thi tại `D:\TQD\CRM`:
- `pnpm -F @abm/crm typecheck`: **Exit 0** (`tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`)
- `pnpm -F @abm/crm build`: **Exit 0** (`vite build` hoàn tất trong 3.70s, tạo `dist/assets/index-D9DuduSj.css` và `dist/assets/index-YMaLBl5P.js`)
- `pnpm -F @abm/crm test`: **Exit 0** (`43 passed | 1 skipped`, `542 passed | 2 skipped` trong 51.64s)

```
Status: DONE
Summary: Đã hoàn thiện tính năng chọn ảnh (+), dán ảnh (Ctrl+V), kéo thả, nén JPEG <= 1 MB trên trình duyệt, xem trước 64px tối đa 4 ảnh, tải lên sớm và gửi ảnh kèm chữ tùy chọn cho kênh Zalo/Zalo OA trong Composer.
```
