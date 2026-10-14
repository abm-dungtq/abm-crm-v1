# Báo cáo: ảnh đại diện người gửi Zalo

Ngày: 14/10/2026. Phạm vi: phase 1 của `plans/261014-1733-zalo-sender-avatars/plan.md`. Không deploy, không đụng VPS, không chạy `wrangler --remote`, không commit.

Giao diện chưa được kiểm tra trên trình duyệt vì nhiệm vụ cấm khởi động dev server.

## Việc đã làm

Inbox lưu và trả về URL ảnh `https` của người gửi. Ảnh không được sao chép sang R2. URL không phải `https`, rỗng, hoặc dài hơn 2000 ký tự bị bỏ; tin nhắn vẫn được lưu.

- Zalo cá nhân, hội thoại 1-1: bridge tra hồ sơ người gửi (cache 24 giờ trên `AccountManager.profile`, timeout 5 giây). Lỗi hoặc quá giờ thì gửi tin không kèm ảnh và không ghi cache lỗi. Ảnh ghi vào `conversation.avatar_url` theo `COALESCE`, cùng quy tắc với tên. Tin do chính tài khoản gửi không ghi đè ảnh khách. `avatar_checked_at` không được đóng dấu cho Zalo cá nhân.
- Nhóm Zalo: ảnh lấy từ hồ sơ thành viên đã tải (`listGroupMembers`) và từ sự kiện `group_members`. Ghi vào `zalo_group_member.avatar_url` theo `COALESCE`. API tin nhắn nhóm `LEFT JOIN` bảng này và trả `senderDisplayName`, `senderAvatarUrl`.
- Zalo OA: `user/detail` trả tên và ảnh. Hội thoại mới, hoặc hội thoại có `avatar_checked_at` null / không đọc được / cũ hơn 24 giờ, được tra lại. Mỗi lần đã gọi API thì đóng dấu `avatar_checked_at`, kể cả khi Zalo lỗi (kể cả mã `-212`). Không có token hợp lệ thì không đóng dấu. Tên thật không bị ghi đè bởi null hay "Khách Zalo OA". Ảnh null không xóa ảnh `https` đang có. Cron mỗi phút bù tối đa 10 hội thoại OA trực tiếp chưa từng được kiểm tra, cũ nhất trước. Danh sách rỗng không gọi lấy token.

`Avatar` nhận `src` tùy chọn. Ảnh nằm trong vòng tròn cũ (`loading="lazy"`, `referrerPolicy="no-referrer"`, `alt=""`). `onError` quay về chữ cái đầu và giữ chữ cái đầu cho đúng URL đó. Dùng ở dòng hội thoại, đầu khung chat, thẻ "Khách trong CRM", danh sách thành viên nhóm, và cạnh tin khách trong nhóm.

## File đã đổi

Mới:

- `apps/crm/migrations/0022_sender_avatars.sql` — chỉ thêm `conversation.avatar_url`, `conversation.avatar_checked_at`, `zalo_group_member.avatar_url`.
- `apps/crm/test/inbox-sender-avatars.test.ts`

Sửa:

- `packages/contracts/src/index.ts` — `senderAvatar` và `avatar` của thành viên nhóm là chuỗi tùy chọn, tối đa 2000 ký tự.
- `apps/zalo-bridge/src/zalo-client.ts` — `httpsAvatarUrl`, ảnh trên hồ sơ và trên thành viên nhóm.
- `apps/zalo-bridge/src/account-manager.ts` — cache hồ sơ, timeout 5 giây, ảnh thành viên trong bộ nhớ.
- `apps/crm/src/worker/inbox/ingest.ts` — nhận ảnh, bỏ URL không phải `https`, `COALESCE` khi ghi.
- `apps/crm/src/worker/inbox/zalo-oa-webhook.ts` — tra hồ sơ OA và `backfillOaSenderAvatars`.
- `apps/crm/src/worker/inbox/scheduled.ts` — gọi bù ảnh sau bước làm mới token OA.
- `apps/crm/src/worker/inbox/inbox-routes.ts` — `avatarUrl` trên hội thoại và thành viên; tin nhắn nhóm kèm tên và ảnh người gửi.
- `apps/crm/src/web/types.ts`, `components/ui.tsx`, `components/inbox-thread.tsx`, `pages/inbox.tsx`, `pages/zalo-groups.tsx`, `styles.css`.
- Test: `apps/crm/test/inbox-zalo-oa.test.ts`, `apps/zalo-bridge/test/zalo-profile.test.ts`, `zalo-group-signals.test.ts`, `account-manager.test.ts`, `command-runner.test.ts`.

Khi typecheck lần đầu, `backfillOaSenderAvatars` đòi cả `Env` trong khi cron chỉ có `ScheduledEnv` (thiếu `ASSETS`). Hàm giờ chỉ nhận `Pick<Env, 'ZALO_OA_TOKEN_KEY'>`, đúng phần `accessToken` cần. Hai chỗ test được siết null (`group!`, `failed!`, `skipped!`).

## Trường hồ sơ Zalo và bằng chứng kiểu

Zalo cá nhân, `zca-js`:

- `apps/zalo-bridge/node_modules/zca-js/dist/models/User.d.ts` dòng 8: `User.avatar: string`. `getUserInfo` trả `changed_profiles: Record<string, ProfileInfo>` với `ProfileInfo = User` (`apis/getUserInfo.d.ts` dòng 2–6). Bridge đọc `avatar` từ profile đã đổi. Khóa có thể là `userId` hoặc `userId_0`.
- `apps/zalo-bridge/node_modules/zca-js/dist/apis/getGroupMembersInfo.d.ts` dòng 4: `GroupMemberProfile.avatar: string`, cùng `displayName` và `zaloName`. Thành viên nhóm lấy từ API này.

Chỉ giữ URL sau khi `trim`, dài từ 1 đến 2000, và `new URL(...).protocol === 'https:'`.

Zalo OA không có file `.d.ts` trong repo. Payload là JSON của `https://openapi.zalo.me/v3.0/oa/user/detail`:

- tên: `data.display_name`, bỏ qua chuỗi rỗng và đúng cụm "Khách Zalo OA";
- ảnh: `data.avatar`, không có thì `data.avatars['240']`, rồi `data.avatars['120']`, cùng bộ lọc `https`.

## Test đã thêm

Worker (`inbox-sender-avatars.test.ts`):

- ảnh khách 1-1 được lưu; URL `http` hoặc rỗng bị bỏ và tin vẫn còn; tin của chính tài khoản không thay ảnh khách; Zalo cá nhân để `avatar_checked_at` null;
- tin nhóm và sự kiện `group_members` ghi ảnh thành viên theo `COALESCE`; API danh sách, chi tiết, tin nhắn nhóm và danh sách thành viên trả `avatarUrl` / `senderAvatarUrl`.

OA (`inbox-zalo-oa.test.ts`):

- `an OA profile lookup stores the name and an https avatar, with size fallbacks`
- `a placeholder with no avatar check is looked up on the next message`
- `a failed profile lookup stamps the check and is repeated only after a day`
- `the minute backfill refreshes at most 10 unchecked OA conversations`
- `backfill skips an OA with no token and stamps a failed lookup`

Hội thoại của test chữ ký đúng giờ cũng kỳ vọng `avatar_url` và `avatar_checked_at` đều null khi OA chưa có token.

Bridge:

- hồ sơ giữ ảnh `https` (kể cả đã trim) và bỏ `http`, chuỗi rỗng, URL dài hơn 2000;
- `listGroupMembers` giữ ảnh `https` của thành viên và bỏ ảnh không phải `https`;
- tin 1-1 của khách gắn ảnh từ cache, chỉ gọi `getUserInfo` một lần; ảnh không hợp lệ bị bỏ;
- tra hồ sơ quá 5 giây vẫn phát tin, không có `senderAvatar`;
- roster nhóm và tin của thành viên đó mang ảnh; thành viên chỉ có URL `http` thì bỏ trường;
- hồ sơ chỉ có ảnh (`name` rỗng, `gender` null) không đổi câu prompt của bot.

## Kết quả kiểm tra

Lần typecheck CRM đầu tiên thoát 1 (7 lỗi ở `scheduled.ts` và hai file test). Sau khi sửa, cả năm lệnh thoát 0.

```text
pnpm -F @abm/crm typecheck
exit 0
tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit

pnpm -F @abm/crm test
exit 0
Test Files  42 passed | 1 skipped (43)
     Tests  530 passed | 2 skipped (532)
Duration  51.33s

pnpm -F @abm/crm build
exit 0
vite v7.3.6 built in 5.04s
dist/assets/index-qYTdutkO.js  763.68 kB (gzip 211.68 kB)
Cảnh báo chunk lớn hơn 500 kB là cảnh báo sẵn của Vite, không làm lệnh thất bại.

pnpm -F @abm/zalo-bridge typecheck
exit 0
tsc --noEmit

pnpm -F @abm/zalo-bridge test
exit 0
Test Files  9 passed (9)
     Tests  102 passed (102)
Duration  1.52s
```

```
Status: DONE
Summary: Ảnh https của người gửi Zalo cá nhân, Zalo OA và thành viên nhóm được lưu, trả về API và vẽ trong inbox, có fallback chữ cái đầu. Năm lệnh typecheck, test và build đều thoát 0; giao diện chưa mở trên trình duyệt vì nhiệm vụ cấm dev server.
```
