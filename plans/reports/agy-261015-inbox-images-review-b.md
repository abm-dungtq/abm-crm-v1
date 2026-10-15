# Báo cáo soát code độc lập Phase B: Nhân viên gửi ảnh (Worker + Zalo bridge)

- **Ngày soát:** 15/10/2026 (Asia/Saigon)
- **Người soát:** Gemini 4 Argon (độc lập, chỉ đọc)
- **Phạm vi:** Các thay đổi chưa commit của Phase B ngoài `apps/crm/src/web/**` (`apps/crm/src/worker/**`, `apps/crm/test/**`, `apps/crm/wrangler.jsonc`, `apps/zalo-bridge/**`) đối chiếu với `plans/261015-0904-inbox-images/plan.md`, đề bài Phase B và báo cáo `plans/reports/grok-261015-inbox-images-b-backend.md`.

---

## Kết quả chạy kiểm tra tự động (Read-only Checks)

Tất cả các lệnh kiểm tra đều thoát với mã `0`:
- `pnpm -F @abm/crm typecheck` — **PASS** (`tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`)
- `pnpm -F @abm/crm test` — **PASS** (`test/inbox-media.test.ts`, `test/inbox-zalo-oa.test.ts` — 43 tests passed)
- `pnpm -F @abm/zalo-bridge typecheck` — **PASS** (`tsc --noEmit`)
- `pnpm -F @abm/zalo-bridge test` — **PASS** (9 files, 105 tests passed)

---

## Các phát hiện (Xếp theo mức độ nghiêm trọng)

### 1. [High] Webhook Zalo OA (`linkOwnImageSend`) nuốt nhầm ảnh/sticker/GIF gửi từ ứng dụng Zalo OA trong 120 giây sau khi gửi ảnh qua CRM, gán chéo `external_msg_id` khi gửi 2 tin ảnh liên tiếp, và có thể lọt dòng trùng khi có ≥ 5 tin chữ xen giữa
- **Trạng thái:** **Confirmed** (đã xác minh trực tiếp trong mã nguồn)
- **Vị trí:** `apps/crm/src/worker/inbox/zalo-oa-webhook.ts:214-264`, `apps/crm/src/worker/inbox/zalo-oa-webhook.ts:508-510`, `apps/crm/src/worker/inbox/zalo-oa-send.ts:260-265`
- **Kịch bản lỗi cụ thể:**
  1. **Mất tin nhắn `staff_phone` gửi từ ứng dụng Zalo OA trong cửa sổ 120 giây:**
     - Nhân viên gửi 1 ảnh qua CRM lúc `T = 0s`. `sendZaloOaCommand` gửi ảnh thành công, nhận `message_id = "mid-1"` và cập nhật `status = 'sent', external_msg_id = 'mid-1'`. Echo `"mid-1"` từ Zalo tới lúc `T = 1s` được `messageExists` chặn đúng.
     - Lúc `T = 30s` (vẫn trong `OWN_SEND_WINDOW_MS = 120_000ms`), nhân viên mở ứng dụng Zalo OA Manager gửi thêm một ảnh khác (`msg_id = "from-oa-app"`) hoặc gửi một sticker/GIF (`oa_send_sticker` / `oa_send_gif` được `crmAttachments` tại dòng `44-46, 110-112` gán `mimeType = 'image/png'` / `'image/gif'`, khiến `echoIsImage` tại dòng `214-217` trả về `true`).
     - Khi webhook nhận `"from-oa-app"`, `linkOwnImageSend` (dòng `237-256`) tìm các tin `out` có `status IN ('pending', 'sent')` trong 120 giây và khớp lại chính tin CRM lúc `T = 0s` (dù tin đó đã có `external_msg_id = 'mid-1'` và chỉ có 1 ảnh đã gửi xong), rồi trả về `true`. Ảnh/sticker/GIF gửi từ app OA bị nuốt mất hoàn toàn, không lưu vào hội thoại và không cập nhật `last_staff_reply_at`.
  2. **Gán chéo `external_msg_id` giữa 2 tin ảnh liên tiếp:**
     - `sendZaloOaCommand` (`zalo-oa-send.ts:260-265`) chỉ lưu `firstMid` (nếu tin có chữ kèm ảnh thì `firstMid` là `message_id` của phần chữ) và bỏ rơi `message_id` trả về từ các lần gọi `postImage` tiếp theo.
     - Nếu nhân viên gửi Tin A (chữ + ảnh) rồi gửi tiếp Tin B (chỉ ảnh, vừa lưu vào DB với `status = 'pending', external_msg_id = NULL` chưa kịp gửi xong), khi echo `oa_send_image` của Tin A (`"mid-A-img"`) tới webhook, `linkOwnImageSend` sắp xếp ứng viên mới nhất lên đầu (`ORDER BY ... DESC`) nên lấy Tin B (`candidates.results[0]`) và gọi `fillExternalMsgId(db, msgB.id, "mid-A-img")`. Tin B bị gắn nhầm `external_msg_id` của Tin A; khi Tin B thật sự gửi xong (`"mid-B-img"`), `markMessageSent` không ghi được `"mid-B-img"` vào Tin B nữa vì `external_msg_id` đã khác `NULL`, làm hỏng đối chiếu sự kiện `user_seen_message` / `user_received_message`.
  3. **Tạo dòng trùng khi có 5 tin chỉ-chữ xen giữa trong 120 giây:**
     - Truy vấn trong `linkOwnImageSend` (`zalo-oa-webhook.ts:237-255`) lấy `LIMIT 5` (`OWN_SEND_CANDIDATES`) cho **mọi** tin `out` mà không lọc điều kiện có ảnh trong SQL, sau đó mới lọc `.find((row) => ...)` trong JS. Nếu có 5 tin chữ được tạo/cập nhật sau tin ảnh trong cửa sổ 120 giây (trong khi lệnh gửi ảnh retry hoặc echo ảnh tới trễ), tin ảnh bị đẩy khỏi 5 dòng đầu, `linkOwnImageSend` trả về `false` và echo ảnh tạo ra một dòng `staff_phone` trùng lặp.
- **Hướng sửa đề xuất:**
  - Trong `zalo-oa-send.ts`: Lưu toàn bộ các `message_id` mà Zalo OA trả về cho từng bước (cả `postText` và mọi lần gọi `postImage`) vào `payload_json` (qua `recordProgress`, ví dụ mảng `sentMids: string[]`) và `result_json`.
  - Trong `zalo-oa-webhook.ts`:
    - Đối chiếu `msgId` của echo với mảng `sentMids` trong `channel_command` (`kind = 'send_zalo_oa'`) của hội thoại để nhận diện chính xác echo của từng phần.
    - Với `linkOwnImageSend` (dự phòng khi echo tới trước lúc `recordProgress` kịp commit): đưa điều kiện lọc tin có ảnh vào thẳng mệnh đề `WHERE` của SQL, chỉ khớp tin đang gửi (`status = 'pending'` hoặc lệnh `send_zalo_oa` chưa ghi đủ số `sentMids` tương ứng với số bước), và trong `echoIsImage` chỉ nhận `name === 'oa_send_image'` hoặc attachment có `type === 'image'` (tránh khớp nhầm `sticker`/`gif`).

---

### 2. [High] Personal Zalo (`CommandRunner.sendZalo` + `zca-js`): Gửi chữ kèm nhiều ảnh (2–4 ảnh) hoặc kèm trích dẫn (`replyTo`) sẽ gửi lặp lại chữ khi bước tải/gửi ảnh lỗi, và có thể đánh dấu nhầm tin là `'sent'` hoặc tạo dòng trùng
- **Trạng thái:** **Confirmed** (đã xác minh đối chiếu với `node_modules/.pnpm/zca-js@2.2.0/node_modules/zca-js/dist/apis/sendMessage.js:430-445`)
- **Vị trí:** `apps/zalo-bridge/src/command-runner.ts:341-363`, `apps/zalo-bridge/src/account-manager.ts:158-165`, `apps/crm/src/worker/inbox/ingest.ts:107-116`
- **Kịch bản lỗi cụ thể:**
  - Trong `CommandRunner.sendZalo` (`command-runner.ts:341-356`), đoạn chữ cuối (hoặc toàn bộ chữ nếu `<= 2000` ký tự) được truyền chung với toàn bộ mảng `files` vào một lần gọi `accounts.send(..., steps[index]!, command.id, reply, withFiles)`.
  - Bên trong `zca-js@2.2.0` (`dist/apis/sendMessage.js:432-443`), biến `canBeDesc` chỉ bằng `true` khi `attachments.length == 1`. Khi gửi chữ kèm 2–4 ảnh (`attachments.length > 1`) hoặc khi có `quote` (`replyTo` trong nhóm), `zca-js` tự tách thành 2 bước tuần tự trong cùng một hàm `sendMessage()`:
    1. Gọi `handleMessage()` để gửi tin nhắn văn bản trước (`responses.message = (await send(data))[0]`).
    2. Sau đó gọi `handleAttachment()` để upload toàn bộ ảnh (`api.uploadAttachment`) rồi gửi đồng loạt các ảnh (`await send(handledData)` qua `Promise.all`).
  - **Khi xảy ra lỗi một phần (partial failure):** Nếu bước 1 (gửi chữ) thành công nhưng bước 2 (upload/gửi ảnh) ném lỗi (hoặc ảnh 1 gửi thành công nhưng ảnh 2 trong `Promise.all` lỗi):
    1. `api.sendMessage()` ném lỗi ra ngoài, khiến `ZcaSession.send` và `AccountManager.send` không trả về `msgIds` nào (không ghi vào `this.sent`), và `CommandRunner.sendZalo` không cập nhật `this.sendProgress`.
    2. Khi lệnh `send_zalo` được retry, `CommandRunner.sendZalo` chạy lại từ đầu và **gửi lại phần chữ (cùng các ảnh đã gửi) lần thứ hai** cho khách.
    3. Đồng thời, tin nhắn chữ (và bất kỳ ảnh nào đã kịp gửi trong `Promise.all`) vẫn tạo sự kiện echo `fromSelf` từ Zalo nhưng không có `commandId` (do `this.sent` không được ghi). Với echo chữ, `applyEcho` (`ingest.ts:107-116`) khớp theo nội dung văn bản và gọi `markMessageSent`, đánh dấu tin trong CRM thành `status = 'sent'` dù ảnh bị lỗi. Với echo ảnh (có `event.text === ""`), `applyEcho` trả về `false` khiến `ingestMessage` chèn thêm một dòng `staff_phone` trùng lặp vào hội thoại.
  - **Khi mạng chậm (echo tới sớm):** Ngay cả khi không lỗi, vì tin chữ được `zca-js` gửi đi trước khi bắt đầu upload 2–4 ảnh, echo của tin chữ đến ngay trong lúc `sendMessage()` vẫn đang chờ upload ảnh. Nếu việc upload và gửi 2–4 ảnh kéo dài quá `ECHO_HOLD_MS` (`3000ms`, `account-manager.ts:17, 368`), bộ đếm giữ echo hết hạn trước khi `session.send()` kịp trả về để ghi `msgId` vào `this.sent`.
- **Hướng sửa đề xuất:**
  - Trong `CommandRunner.sendZalo` (`apps/zalo-bridge/src/command-runner.ts:341-356`): tách các đoạn chữ (`chunks`) và từng tệp ảnh thành các bước gửi độc lập trong `steps` (hoặc ít nhất tách riêng bước gửi chữ và gửi từng ảnh một, mỗi lần gọi `accounts.send` tối đa 1 ảnh), lưu tiến độ `this.rememberProgress` sau từng bước. Nhờ đó:
    - Nếu chữ hoặc ảnh thứ nhất đã gửi xong mà ảnh thứ hai lỗi, lần retry chỉ gửi tiếp từ ảnh thứ hai, không bao giờ gửi lặp chữ hay ảnh trước đó.
    - Mỗi lần gọi `session.send` chỉ gửi 1 tin nhắn nên `msgId` được ghi vào `this.sent` ngay khi tin đó vừa gửi xong.

---

### 3. [Medium] Route `POST /api/inbox/media` chỉ kiểm tra header `Content-Length` mà không giới hạn kích thước luồng đọc thực tế trước khi đệm body vào bộ nhớ
- **Trạng thái:** **Confirmed** (đã xác minh trực tiếp trong mã nguồn)
- **Vị trí:** `apps/crm/src/worker/inbox/inbox-routes.ts:202-207`
- **Kịch bản lỗi cụ thể:**
  - Tại `inbox-routes.ts:203-207`:
    ```ts
    const declaredLength = Number(c.req.header('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MEDIA_MAX_BYTES + MEDIA_BODY_OVERHEAD) {
      return c.json(fail('PAYLOAD_TOO_LARGE', 'Ảnh lớn hơn 1 MB'), 413);
    }
    const form = await c.req.parseBody().catch(() => null);
    ```
  - Khác với `bridgeRoutes`, `zaloOaRoutes` và `facebookWebhookRoutes` đều dùng middleware `bodyLimit` của `hono/body-limit`, route upload ảnh chỉ kiểm tra giá trị của header `Content-Length`.
  - Nếu client gửi request không có header `Content-Length` (ví dụ `Transfer-Encoding: chunked` / HTTP/2 streaming, khi đó `Number(undefined)` là `NaN` nên `Number.isFinite(declaredLength)` bằng `false`) hoặc gửi `Content-Length` giả nhỏ hơn body thật, lệnh `await c.req.parseBody()` sẽ đọc và đệm toàn bộ luồng multipart vào bộ nhớ RAM của Worker trước khi kiểm tra `file.size > MEDIA_MAX_BYTES` ở dòng `210`.
- **Hướng sửa đề xuất:**
  - Gắn middleware `bodyLimit` từ `hono/body-limit` cho route `POST /media`:
    ```ts
    bodyLimit({
      maxSize: MEDIA_MAX_BYTES + MEDIA_BODY_OVERHEAD,
      onError: (c) => c.json(fail('PAYLOAD_TOO_LARGE', 'Ảnh lớn hơn 1 MB'), 413),
    })
    ```
    để ngắt luồng `ReadableStream` ngay khi số byte đọc vượt ngưỡng `MEDIA_MAX_BYTES + MEDIA_BODY_OVERHEAD`.

---

### 4. [Low] `imageDimensions` không xử lý fill bytes `0xFF` hợp lệ của JPEG và thiếu kiểm thử đơn vị cho `ZcaSession.send` kèm ảnh, JPEG dimensions, OA partial failure
- **Trạng thái:** **Confirmed** (đã xác minh trong mã nguồn và bộ test)
- **Vị trí:** `apps/zalo-bridge/src/zalo-client.ts:85-102`, `apps/zalo-bridge/src/zalo-client.ts:332-357`, `apps/zalo-bridge/test/command-runner.test.ts:136-170`, `apps/crm/test/inbox-zalo-oa.test.ts:713-807`
- **Kịch bản lỗi cụ thể:**
  1. **Parser kích thước JPEG (`zalo-client.ts:87-101`):** Theo chuẩn JPEG (ITU-T T.81 mục B.1.1.2), trước bất kỳ marker nào cũng có thể có các byte đệm `0xFF` liên tiếp (ví dụ `0xFF 0xFF 0xC0`). Trong `imageDimensions`, khi gặp `0xFF 0xFF`, biến `marker` nhận giá trị `0xff` và hàm đọc nhầm 2 byte kế tiếp làm `length` của segment thay vì dịch qua byte đệm `0xFF`, dẫn tới trả về `{}` (làm mất `width` và `height` trong `metadata` gửi cho `zca-js`). Ngoài ra các marker `0xD0`–`0xD7` (RST0–RST7, không có length) hoặc SOF khác (`0xC3`, `0xC5`–`0xC7`, `0xC9`–`0xCB`, `0xCD`–`0xCF`) chưa được xử lý.
  2. **Khoảng trống trong bộ test:**
     - `ZcaSession.send` (`zalo-client.ts:332-357`) — nơi trực tiếp đóng gói `content.attachments` (`{ data: Buffer, filename, metadata: { totalSize, width, height } }`), gọi `api.sendMessage` của `zca-js` và trích xuất `msgIds` từ `result.message` + `result.attachment` — chưa có test nào gọi vào (do `command-runner.test.ts` mock `accounts.send` và `account-manager.test.ts` mock `session.send`).
     - `imageDimensions` chỉ mới được test với PNG (`command-runner.test.ts:137-140`), chưa có test cho JPEG.
     - Trong `inbox-zalo-oa.test.ts`, chưa có test cho kịch bản lỗi một phần (partial failure: phần chữ gửi thành công, phần ảnh lỗi tạm thời, và lần retry sau chỉ gửi lại phần ảnh mà không gửi lại phần chữ).
     - Trong `inbox-media.test.ts`, chưa có test xác nhận gửi đính kèm ảnh trên hội thoại kênh `facebook` trả về `422` (`unsupported`).
- **Hướng sửa đề xuất:**
  - Trong `imageDimensions` (`zalo-client.ts:87-90`): bỏ qua chuỗi byte `0xFF` liên tiếp (`while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;`) trước khi đọc mã marker, và bỏ qua `0xD0`–`0xD7` như `0xD8`/`0x01`.
  - Bổ sung test cho `ZcaSession.send` với `files` trong `zalo-group-signals.test.ts`, test `imageDimensions` với JPEG, test retry partial failure của `send_zalo_oa` trong `inbox-zalo-oa.test.ts`, và test kênh `facebook` từ chối ảnh (`422`) trong `inbox-media.test.ts`.

---

### 5. [Low] Gửi tin nhắn chỉ-chữ có nội dung đúng bằng `"[Tệp đính kèm]"` qua Zalo OA sẽ thất bại với `INVALID_PAYLOAD`
- **Trạng thái:** **Confirmed** (đã xác minh trực tiếp trong mã nguồn)
- **Vị trí:** `apps/crm/src/worker/inbox/zalo-oa-send.ts:163-165`, `apps/crm/src/worker/inbox/zalo-oa-send.ts:212`
- **Kịch bản lỗi cụ thể:**
  - Trong `oaSteps(body, attachmentsJson)` (`zalo-oa-send.ts:164`):
    ```ts
    const source = body === ATTACHMENT_ONLY_TEXT ? '' : body;
    ```
  - Hàm xoá `body` thành chuỗi rỗng `''` khi `body === '[Tệp đính kèm]'` mà không kiểm tra `attachmentsJson` có ảnh hay không. Nếu nhân viên hoặc bot gửi một tin nhắn văn bản thuần có chữ đúng bằng `"[Tệp đính kèm]"` (`attachments_json` là `null`), `oaSteps` trả về `[]` và `sendZaloOaCommand` (dòng `212`) đánh dấu lệnh lỗi với `INVALID_PAYLOAD`.
- **Hướng sửa đề xuất:**
  - Chỉ coi `ATTACHMENT_ONLY_TEXT` là placeholder rỗng khi tin nhắn thực sự có `attachmentsJson`:
    ```ts
    const source = body === ATTACHMENT_ONLY_TEXT && attachmentsJson ? '' : body;
    ```

---

## Đánh giá các hạng mục khác trong phạm vi soát

- **Bảo mật & Cách ly tổ chức (Auth, Org Isolation, Path Traversal, Magic Bytes, Headers):**
  - `POST /api/inbox/media` và `GET /api/inbox/media/*` đều nằm dưới `originGuard`, `requireActor` và middleware kiểm tra `INBOX_ROLES` (`sale`, `leader`, `head`, `director`, `admin`; `teacher` bị chặn `403`, không có session bị chặn `401`).
  - `ownsMediaKey` + `isSafeMediaKey` (`media.ts:41-51`) kết hợp `decodeURIComponent` kiểm tra chặt tiền tố `org/<organizationId>/<yyyy>/<mm>/<uuid>.(jpg|png)` và chặn `..`, `\`, `\0`. Mọi biến thể path traversal (`..`, `%2e%2e`, `%252e%252e`) hoặc truy cập chéo tổ chức trong cả `GET /api/inbox/media/*`, `POST /api/inbox/conversations/:id/messages` (`loadOwnedAttachments`) và `GET /api/bridge/media` đều bị từ chối đồng nhất (`404` hoặc `422`).
  - `sniffImage` kiểm tra đúng magic bytes của JPEG (`FF D8 FF`) và PNG (`89 50 4E 47 0D 0A 1A 0A`) và buộc phải khớp với kiểu MIME khai báo.
  - Phục vụ ảnh trả đầy đủ `Content-Type`, `Cache-Control: private, max-age=31536000, immutable` và `X-Content-Type-Options: nosniff`.
- **Endpoint & Payload Zalo OA:**
  - Endpoint upload `https://openapi.zalo.me/v2.0/oa/upload/image` (multipart field `file`, header `access_token`) và payload gửi ảnh qua `https://openapi.zalo.me/v3.0/oa/message/cs` (`attachment.type = "template"`, `payload.template_type = "media"`, `elements: [{ media_type: "image", attachment_id }]`) khớp với tài liệu và SDK chính thức của Zalo.
  - Xử lý mã lỗi ngoài cửa sổ 48h (`-213, -217, -227, -230, -232` -> lỗi cuối + ghi chú hệ thống) và làm mới token một lần khi gặp `-216` / HTTP `401` hoạt động đúng.
  - Với Zalo OA, khi phần chữ gửi xong và được `recordProgress` lưu `sentChunks = 1` trước khi phần ảnh lỗi tạm thời, lần retry tiếp theo bắt đầu từ `index = progress.sentChunks` (`1`) nên không gửi lại phần chữ.
- **Lý do sửa `scheduled.ts` và `worker-commands.ts`:**
  - Chỉ mở rộng kiểu `ScheduledEnv` và `WorkerCommandEnv` thêm `'MEDIA'` trong `Pick<Env, ...>` để truyền `env` xuống `sendZaloOaCommand(env, command)`. Không làm thay đổi hành vi của cron hay các worker command hiện có.

```
Status: DONE
Summary: Phát hiện 2 lỗi mức High (OA webhook nuốt nhầm ảnh/sticker gửi từ app OA trong 120s hoặc gán chéo external_msg_id giữa 2 tin ảnh; Personal Zalo gộp chữ và nhiều ảnh vào một lệnh zca-js gây gửi lặp chữ hoặc lệch trạng thái khi lỗi một phần), 1 lỗi mức Medium (POST /api/inbox/media thiếu streaming bodyLimit) và 2 lỗi mức Low (imageDimensions với fill bytes 0xFF của JPEG cùng khoảng trống unit test cho ZcaSession.send; placeholder [Tệp đính kèm] khi gửi chữ thuần trên OA).
```
