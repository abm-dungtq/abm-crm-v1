# Phase B: nhân viên gửi ảnh (Worker + Zalo bridge)

Plan: `plans/261015-0904-inbox-images/plan.md`. Pha này chỉ Worker và bridge. Không sửa `apps/crm/src/web/**`, không sửa `packages/contracts` (`sendTextInput` nằm trong `inbox-routes.ts`), không tạo bucket R2, không chạy `wrangler --remote`, không bật dev server, không đụng VPS / GoClaw / D1 remote, không commit.

Ảnh khách gửi vào vẫn là URL CDN trong `message.attachments_json`. Facebook không gửi ảnh: kênh không phải `zalo` hoặc `zalo_oa` mà có ảnh thì `422` `Kênh này chưa gửi được ảnh`.

## Hợp đồng HTTP cho pha web

Mọi route inbox dùng session như các route inbox khác (demo: `X-Demo-User`). Lỗi có dạng `{ ok: false, error: { code, message, fields? } }`. Thành công JSON có dạng `{ ok: true, data }`.

### `POST /api/inbox/media`

- `multipart/form-data`, field `file`.
- Chỉ nhận `image/jpeg` và `image/png`. Magic bytes phải khớp loại khai báo (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`). Khai báo một loại mà bytes là loại kia thì `422`.
- Tối đa 1 MB. Lớn hơn: `413` `PAYLOAD_TOO_LARGE`, message `Ảnh lớn hơn 1 MB`. File rỗng hoặc thiếu field: `422`, `fields.file = Cần một ảnh JPEG hoặc PNG`. Sai loại: `422`, message `Chỉ nhận ảnh JPEG hoặc PNG`.
- Giáo viên (ngoài vai inbox): `403`. Không có session: `401`.

`201` không dùng. Thành công `200`:

```json
{
  "ok": true,
  "data": {
    "key": "org/<organizationId>/<yyyy>/<mm>/<uuid>.jpg",
    "url": "/api/inbox/media/org/<organizationId>/<yyyy>/<mm>/<uuid>.jpg",
    "mimeType": "image/jpeg",
    "size": 12345
  }
}
```

`yyyy`/`mm` theo lịch Asia/Saigon. Đuôi là `jpg` hoặc `png`. Web phải dùng đúng `data.url` làm đường dẫn. Không `encodeURIComponent` cả key: `%2F` không được giải thành `/`, request sẽ `404`.

### `GET /api/inbox/media/<key>`

Key phải là `org/<organizationId của người đăng nhập>/yyyy/mm/<uuid>.jpg|png`, không có `..`. Sai tổ chức, key lạ, hoặc object không còn: cùng một `404`

```json
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "Không tìm thấy trong phạm vi của bạn" } }
```

Thành công là bytes của ảnh, không phải JSON.

- `Content-Type`: loại đã lưu (`image/jpeg` hoặc `image/png`)
- `Cache-Control: private, max-age=31536000, immutable`
- `X-Content-Type-Options: nosniff`

`<img src>` cùng origin, kèm cookie session, là đủ. Ảnh tổ chức khác không đọc được.

### `POST /api/inbox/conversations/:id/messages`

Body JSON:

```json
{
  "text": "tùy chọn, tối đa 2000 ký tự sau trim",
  "clientMessageId": "tùy chọn, /^[A-Za-z0-9_-]{8,64}$/",
  "attachments": [{ "key": "<key trả về từ POST /media>" }]
}
```

- Tối đa 4 ảnh. Phải có `text` hoặc ít nhất một ảnh. Thiếu cả hai: `422`, `fields.text = Cần nội dung hoặc ảnh`.
- Mỗi key phải đang nằm trong R2 của đúng tổ chức và đúng dạng key ở trên. Sai: `422`, `fields.attachments = Ảnh không tồn tại`.
- Cùng `clientMessageId` mà khác chữ, khác người gửi, hoặc khác danh sách ảnh: `409` `IDEMPOTENCY_CONFLICT`. Cùng chữ và cùng key: trả lại đúng message cũ, không gửi lần hai.
- Kênh Facebook (hoặc kênh khác Zalo) kèm ảnh: `422`, message `Kênh này chưa gửi được ảnh`.

Tin lưu trong CRM:

- Có chữ: `body` là chữ đó. Chỉ ảnh: `body` là `[Tệp đính kèm]`. Chuỗi này chỉ để hiện trong CRM và đưa vào `appendStaffContext` (`Nhân viên: ...`). Không gửi chuỗi này sang Zalo.
- `attachments_json`: `[{ "url": "/api/inbox/media/<key>", "mimeType": "image/jpeg"|"image/png", "name"?: "<tên file>" }]`.
- Pha web đọc `url` đó để vẽ ảnh đã gửi. Echo Zalo không thay URL này khi tin đã có ảnh.

`200`: cùng dạng gửi chữ hiện tại (`data.messageId`, cờ replay nếu có).

### Route bridge (không dành cho web)

`GET /api/bridge/media?key=&accountId=` ký HMAC như poll lệnh (GET ký body rỗng). Bridge tải bytes. Sai chữ ký `401`. Sai tài khoản, sai tổ chức, hoặc thiếu object: `404` JSON, không phân biệt lý do.

## Cách gửi ra Zalo

**OA.** Có chữ thì gửi chữ trước bằng `message/cs` như hiện tại (cắt 2000). Mỗi ảnh là một lần gọi riêng, không lặp caption. Chỉ ảnh thì không gọi `message/cs` với `[Tệp đính kèm]`. Lỗi Zalo giữ cách cũ: `-213 -217 -227 -230 -232` là cuối (`ZALO_OA_OUTSIDE_WINDOW`) và có tin hệ thống `Quá thời hạn trả lời của Zalo OA (...)`. `-216` hoặc HTTP 401 làm mới token một lần. Echo `oa_send_image` (hoặc echo có ảnh) trong 120 giây khớp tin của mình nếu body là placeholder hoặc `attachments_json` có ảnh. Echo thứ hai vẫn bị nuốt dù `external_msg_id` đã có. Echo ảnh không khớp tin chỉ có chữ. URL Zalo chỉ ghi vào tin của mình khi tin đó chưa có ảnh.

**Zalo cá nhân.** Payload `send_zalo` thêm `attachments: [{ key, mimeType, filename }]` khi có ảnh. `text` của lệnh chỉ-ảnh là `""`. Bridge tải từng ảnh qua route HMAC rồi `sendMessage({ msg, attachments: [{ data, filename, metadata }] })`. Mọi `msgId` (kể cả `result.attachment`) được ghi trước khi `send()` trả, nên echo tới sớm vẫn gắn `commandId`. Gửi chỉ chữ không đổi số tham số.

## Bằng chứng payload Zalo

Endpoint chính thức, `zaloplatform/zalo-php-sdk` `src/ZaloEndPoint.php`:

```php
const API_OA_UPLOAD_PHOTO = 'https://openapi.zalo.me/v2.0/oa/upload/image';
const API_OA_SEND_CONSULTATION_MESSAGE_V3 = 'https://openapi.zalo.me/v3.0/oa/message/cs';
```

Upload, README cùng repo, mục **Upload hình**:

```php
$data = array('file' => new ZaloFile($filePath));
$response = $zalo->post(ZaloEndPoint::API_OA_UPLOAD_PHOTO, $accessToken, $data);
```

Gửi ảnh bằng `attachment_id`, README mục gửi media:

```php
$msgBuilder = new MessageBuilder('media');
$msgBuilder->withUserId('494021888309207992');
$msgBuilder->withText('Message Image');
$msgBuilder->withAttachment('cb2ab1696b688236db79');
```

Khuôn JSON, `zalo-api@0.3.0` `dist/types.d.ts`:

```ts
interface TemplateMessage<T> extends TextMessage {
    attachment: {
        type: 'template';
        payload: T;
    };
}
declare type MediaTemplateMessage = TemplateMessage<{
    template_type: 'media';
    elements: [
        {
            media_type: string;
            attachment_id: string;
            width?: number;
            height?: number;
        }
    ];
}>;
export declare type OaUploadImageResponse = OaBaseResponseWithData<{
    attachment_id: string;
}>;
```

Wrapper `nh4ttruong/zalo-oa-api-wrapper` `dependencies/messages.py`, `send_message_with_image`, POST `message/cs`:

```python
data["message"]["attachment"] = {
    "type": "template",
    "payload": {
        "template_type": "media",
        "elements": [{
            "media_type": "image"
        }]
    }
}
# rồi gán elements[0]["attachment_id"]
```

SDK PHP có thể gắn `withText` lên cùng tin media, nên caption sẽ hiện lại. Pha này gửi chữ một tin riêng trước, rồi mỗi ảnh một tin `message/cs` không có `text`, đúng yêu cầu không lặp caption. Header `access_token` giữ như `postText` đang dùng cho `message/cs`.

## `commands.poll_failed` / `CRM_HTTP_500`

Ba lần ngày 14/10, từ 14:10 đến 16:12 UTC, là HTTP 500 thật: client poll chỉ gắn `CRM_HTTP_<status>` khi status ≥ 500. Timeout là `CRM_TIMEOUT`, lỗi mạng là `CRM_NETWORK`.

`GET /api/bridge/commands` ghi `bridge_last_seen_at` rồi lặp tối đa 25 giây, mỗi giây `claimDeliverable` → `claimCommands`. `claimCommands` chạy `db.batch` các `UPDATE ... RETURNING` rồi `results.flatMap((r) => r.results)` và `JSON.parse(row.payload_json)`. `paused.results` và `blocked.results` cũng không được bọc. Mọi throw đi vào `app.onError` và thành 500 `{ code: 'INTERNAL' }`.

Không sửa. Một `payload_json` hỏng sống qua claim sẽ 500 mỗi lần hết lease (300 giây), khoảng 24 lần trong 2 giờ, không khớp 3 lần rời. Cột `bridge_last_seen_at` thiếu thì mọi poll đều 500. Nhịp này hợp lỗi D1 thoáng qua (`db.batch` / `SQLITE_BUSY`) hoặc một phần tử batch mất `results` khi hai poll chồng nhau: timeout client là `wait * 1000 + 30s` trong khi Worker giữ long-poll tới 25 giây. Chưa tái hiện được. Bọc retry quanh poll sẽ che lỗi thật.

## File đã sửa

- `apps/crm/wrangler.jsonc` — binding `MEDIA` / bucket `abm-crm-media` (chưa tạo bucket)
- `apps/crm/src/worker/env.ts` — `MEDIA: R2Bucket`
- `apps/crm/src/worker/inbox/media.ts` — mới: sniff, key, put, head
- `apps/crm/src/worker/inbox/inbox-routes.ts` — upload, serve, body gửi
- `apps/crm/src/worker/inbox/conversation-flow.ts` — lưu ảnh, payload bridge, idempotency
- `apps/crm/src/worker/inbox/bridge-routes.ts` — `GET /media`
- `apps/crm/src/worker/inbox/zalo-oa-send.ts` — upload rồi gửi từng ảnh
- `apps/crm/src/worker/inbox/zalo-oa-webhook.ts` — nuốt echo ảnh
- `apps/crm/src/worker/inbox/worker-commands.ts`, `scheduled.ts` — env có `MEDIA`
- `apps/zalo-bridge/src/crm-client.ts` — `downloadMedia`
- `apps/zalo-bridge/src/zalo-client.ts` — file đính kèm và mọi msgId
- `apps/zalo-bridge/src/account-manager.ts` — ghi msgId trước khi trả
- `apps/zalo-bridge/src/command-runner.ts` — tải ảnh, gắn vào chunk cuối
- Test: `apps/crm/test/inbox-media.test.ts` (mới), `inbox-zalo-oa.test.ts`, `commands.test.ts` (kiểu `MEDIA`); `apps/zalo-bridge/test/command-runner.test.ts`, `account-manager.test.ts`, `crm-client.test.ts`

## Test thêm

Worker:

- Upload: JPEG/PNG, sai magic, sai loại khai báo, quá 1 MB, giáo viên 403, không session 401
- Serve: content-type, cache, nosniff, tổ chức khác và key `..` cùng 404
- Gửi Zalo cá nhân: body placeholder, payload `text: ""` kèm attachments, replay cùng key, 409 khi đổi key hoặc đổi chữ
- Bridge media: HMAC, cách ly theo `accountId`
- OA: thứ tự chữ rồi upload rồi ảnh, không caption, echo không thêm dòng, echo ảnh sau tin chỉ chữ vẫn thành `staff_phone`, `-213` trên lần gọi ảnh là lỗi cuối

Bridge:

- Tải ảnh và `send` một lần với metadata rộng/cao; caption dài tách chunk, ảnh chỉ ở chunk cuối
- Gửi chỉ chữ vẫn 6 tham số
- Mọi msgId của ảnh được ghi, kể cả echo tới trước khi `send()` trả
- `downloadMedia` là GET ký trên body rỗng

## Verify

Từ `D:\TQD\CRM`, 15/10/2026:

- `pnpm -F @abm/crm typecheck` — exit 0 (worker và web)
- `pnpm -F @abm/crm test` — exit 0. 539 passed, 2 skipped. 43 files passed, 1 skipped. Duration 51.32s. Start 09:42:30
- `pnpm -F @abm/zalo-bridge typecheck` — exit 0
- `pnpm -F @abm/zalo-bridge test` — exit 0. 105 passed, 9 files. Duration 1.52s. Start 09:42:29

Bucket `abm-crm-media` chưa được tạo trên Cloudflare. Ảnh chỉ chạy trên binding giả lập của test cho tới khi binding remote tồn tại.

```
Status: DONE
Summary: Nhân viên upload JPEG/PNG vào R2 và gửi qua Zalo OA hoặc Zalo cá nhân; CRM giữ một dòng với URL /api/inbox/media. Poll 500 không sửa vì chưa có lỗi chắc khớp ba lần rời trong log.
```

## Sửa theo soát code

Đối chiếu `plans/reports/agy-261015-inbox-images-review-b.md`, findings 1–5. Hợp đồng HTTP cho web giữ nguyên. Không sửa `apps/crm/src/web/**`.

### 1. Echo ảnh OA

`sendZaloOaCommand` ghi mọi `message_id` Zalo trả về ở từng bước (phần chữ và từng ảnh) vào `payload_json.sentMids`, cạnh `sentChunks` và `firstMid`. Danh sách này cũng có trong result khi lệnh hoàn tất.

`handleOaSend` đối chiếu `msg_id` với `sentMids` của lệnh `send_zalo_oa` cùng hội thoại, trong cửa sổ 120 giây như trước, rồi gắn vào `messageId` của lệnh đó. `fillExternalMsgId` chỉ điền khi dòng còn trống, nên id đầu trên dòng được giữ.

`linkOwnImageSend` chỉ còn cho echo tới trước khi lần gửi ghi được id. Điều kiện “có ảnh” nằm trong SQL: `body` là `[Tệp đính kèm]`, hoặc `attachments_json` có JPEG/PNG. Chỉ khớp dòng `pending`, hoặc dòng mà lệnh đã ghi ít mid hơn số bước ảnh.

`echoIsImage` đúng khi sự kiện là `oa_send_image`, hoặc attachment Zalo có `type` là `image`.

Test trong `apps/crm/test/inbox-zalo-oa.test.ts`:

- `an image from the OA app 30 seconds after a CRM image is stored` — ảnh gõ trên app OA sau 30 giây thành dòng `staff_phone`
- `an echo of CRM image A does not fill CRM image B` — echo của A không ghi `external_msg_id` của B
- `an echo whose id is in sentMids creates no row`
- `a sticker echo inside the image window is stored`

### 2. Zalo cá nhân: một tin mỗi bước

`sendZalo` gửi các chunk chữ trước, rồi mỗi ảnh một lần `accounts.send` với caption rỗng và một file. `replyTo` chỉ ở bước đầu. Tiến độ được nhớ sau mỗi bước, nên lần thử lại tiếp tục đúng bước lỗi và giữ tên `PARTIAL_x_OF_y`. Ảnh được tải ngay trước bước của ảnh đó.

Test trong `apps/zalo-bridge/test/command-runner.test.ts`:

- `sends text and then one message per image, with replyTo only on the first` — chữ cộng 2 ảnh là 3 lần gửi, đúng thứ tự
- `retries only the image that failed` — lỗi ở ảnh 2, lần thử lại chỉ gửi ảnh 2
- `sends one message per image when there is no caption`

### 3. Giới hạn body upload

`POST /api/inbox/media` gắn `bodyLimit` (`hono/body-limit`) với `maxSize: MEDIA_MAX_BYTES + MEDIA_BODY_OVERHEAD`. Vượt cỡ thì `onError` trả 413 `{ code: 'PAYLOAD_TOO_LARGE', message: 'Ảnh lớn hơn 1 MB' }`.

Test: `an upload stream larger than the cap is rejected when Content-Length is absent` trong `apps/crm/test/inbox-media.test.ts`.

### 4. Kích thước JPEG và các test còn thiếu

`imageDimensions` bỏ qua byte `0xFF` đệm trước marker, bỏ qua RST `0xD0`–`0xD7`, và nhận mọi SOF `0xC0`–`0xCF` trừ `0xC4`, `0xC8`, `0xCC`.

Test:

- `reads a JPEG SOF after fill bytes, a restart marker, and a Huffman table` (`zalo-group-signals.test.ts`)
- `passes one attachment and collects message ids from the attachment result` — `ZcaSession.send` nhận `{ data: Buffer, filename, metadata: { totalSize, width, height } }` và lấy msgId từ `result.attachment`
- `a retry after the image call fails sends only the image` (`inbox-zalo-oa.test.ts`) — chữ đã gửi, ảnh lỗi có thể thử lại, lần sau chỉ gửi ảnh
- `a facebook conversation with an attachment is rejected` (`inbox-media.test.ts`) — 422 `Kênh này chưa gửi được ảnh`

### 5. Chữ giữ chỗ

`oaSteps` chỉ coi `[Tệp đính kèm]` là chuỗi rỗng khi tin có `attachments_json`. Tin chỉ ảnh vẫn không đẩy câu này lên Zalo. Test giữ hành vi đó: `an image-only staff send does not post the placeholder, and an image echo does not swallow a text send`.

### Verify

Từ `D:\TQD\CRM`, 15/10/2026, sau khi sửa:

- `pnpm -F @abm/crm typecheck` — exit 0 (worker và web)
- `pnpm -F @abm/crm test` — exit 0. 549 passed, 2 skipped. 43 files passed, 1 skipped. Duration 49.88s. Start 10:18:34
- `pnpm -F @abm/zalo-bridge typecheck` — exit 0
- `pnpm -F @abm/zalo-bridge test` — exit 0. 110 passed, 9 files. Duration 1.61s. Start 10:18:19

```
Status: DONE
Summary: Echo ảnh OA khớp theo sentMids; Zalo cá nhân gửi một tin mỗi bước; upload có bodyLimit; JPEG đọc đủ SOF. Bốn lệnh kiểm tra đều exit 0.
```
