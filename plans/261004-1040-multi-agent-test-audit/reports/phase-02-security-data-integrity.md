# Báo cáo phase 02 — bảo mật và toàn vẹn dữ liệu

Ngày 2026-10-04, môi trường D:/TQD/CRM, Asia/Saigon. Đã thêm 41 test pass; 10 sai lệch hoặc giới hạn được xác nhận, không sửa mã sản phẩm. Không có finding critical. Các assertion đỏ dùng cho điều tra được giữ nguyên trong packet cuối báo cáo để coordinator tái hiện, không đưa vào suite chính theo quyết định của plan.

## Ma trận route × vai trò đã kiểm

`O/T/D/G` là own/team/department/organization; Leader còn thấy intake queue cùng department theo scope hiện tại. Mỗi ô đọc đã đối chiếu ID của lead/task/account/approval; detail ngoài scope trả 404. Các ô audit có dấu lỗi được tái hiện riêng bằng probe, không dùng test pass để hợp thức hóa quyền proposed.

| GET route | Sale | Leader | Head | BGĐ | Admin |
| --- | --- | --- | --- | --- | --- |
| /health | Public 200 | Public 200 | Public 200 | Public 200 | Public 200 |
| /demo-users | Public demo 200 | Tương tự | Tương tự | Tương tự | Tương tự |
| /me | Actor hiện tại | Actor hiện tại | Actor hiện tại | Actor hiện tại | Actor hiện tại |
| /dashboard | O | T + queue | D | G | KPI 0, không khách |
| /leads | O | T + queue | D | G | [] |
| /leads/:id | O; ngoài scope 404 | T; ngoài team 404 | D; ngoài department 404 | G; ngoài org 404 | 404 |
| /tasks | Assigned O | T | D | G | [] |
| /accounts | Liên quan O | Liên quan T | Liên quan D | Liên quan G | [] |
| /accounts/:id | Contact/activity/lead có scope | T | D | G | 404 |
| /approvals | O | T | D | G | [] |
| /audit | 403 | 200 T, lỗi S-01 | 200 D, lỗi S-01 | 200 G, lỗi S-01 | 200 G, lỗi S-01 |
| /team-members | Team roster | Team roster | [] | [] | [] |
| /search | O | T | D | G | leads/accounts [] |
| /admin/overview | 403 | 403 | 403 | 403 | 200 cấu hình |

| POST /commands/:name | Sale | Leader | Head | BGĐ | Admin |
| --- | --- | --- | --- | --- | --- |
| createLead | Self active | Intake queue | Intake queue | Intake queue | 403 |
| assignLead / releaseLead | 403 | T + queue / T | 403 | 403 | 403 |
| logActivity / completeTask / changeStage | O | T | D | G | 403 |
| requestOwnerChange | O, cùng team | 403 | 403 | 403 | 403 |
| decideApproval | Owner stage proposal | Team approver | 403 | 403 | 403 |

Command role gates được kiểm đủ 5 × 8 bằng input thiếu trường để phân biệt 403 với 422; không suy rằng mọi role-allowed payload đều hợp lệ. Bảy command có target được kiểm deny ngoài scope cho Sale/Leader/Admin; createLead của Admin bị deny. Head/BGĐ được kiểm deny logActivity ngoài department/org. Tám command đều có ca thành công với audit/outbox/idempotency. Không có route task detail, approval detail, MCP hay agent intake trong bản này.

## Phát hiện đã xác nhận

### S-01 — high — Quyền audit proposed đang được bật

- Vị trí: `apps/crm/src/worker/queries.ts:221`, `queries.ts:200`, `index.ts:57`.
- Tái hiện: probe `audit capability`; GET /api/audit lần lượt với u-hung/u-head/u-bgd/u-admin.
- Mong đợi: 403 khi chưa có capability đã duyệt. Thực tế: cả bốn trả 200; Admin đọc audit nghiệp vụ org, gồm before/after và code lead.
- Nguồn: `docs/security/permission-matrix-v1.md`, mục Critical permissions và các ô Audit proposed. Test cũ cho Leader xem audit không thay thế quyết định cấp quyền.

### S-02 — high — DUPLICATE_SUSPECTED tiết lộ lead ngoài scope

- Vị trí: `apps/crm/src/worker/commands.ts:192`, `commands.ts:210`.
- Tái hiện: probe `duplicate details`, Sale u-lan createLead với phone 0900100010 trong seed.
- Mong đợi: kiểm trùng không tiết lộ projection ngoài quyền của caller. Thực tế: 409 kèm code L-0010, stage và tên owner của team khác, trong khi GET lead-10 trả 404.
- Nguồn: permission matrix Customer/Lead own và security baseline kiểm quyền mọi projection. Giữ kiểm trùng org-wide được; chi tiết cần projection phù hợp.

### S-03 — medium — Cùng key khác actor không conflict theo ADR

- Vị trí: `apps/crm/src/worker/commands.ts:67`, `apps/crm/migrations/0001_init.sql:215`.
- Tái hiện: probe `same idempotency key`, hai actor gọi logActivity trên target họ có quyền với cùng shared-key.
- Mong đợi: IDEMPOTENCY_CONFLICT cho actor thứ hai theo ADR-003/005. Thực tế: cả hai 200, ghi riêng theo PK(actor_user_id,key).
- Nguồn: ADR-003/005 quy định cùng key khác actor conflict. Đây là sai lệch namespace contract; không phải actor thứ hai đọc được stored result của actor thứ nhất.

### S-04 — medium — Replay bỏ qua scope target hiện tại

- Vị trí: `apps/crm/src/worker/commands.ts:91`, `commands.ts:95`.
- Tái hiện: probe `replay rechecks`: u-lan logActivity lead-04 với replay-key; Leader chuyển lead cho u-long ở version 2; u-lan gửi lại body/key cũ.
- Mong đợi: 404/deny sau khi mất quyền target. Thực tế: 200 stored result, dù GET lead-04 không còn thuộc Sale; không tạo mutation lần hai.
- Nguồn: ADR-003/005 yêu cầu replay kiểm quyền hiện tại. Mức tác động hiện tại giới hạn ở stored result của command (ID/metadata), không chứng minh đọc toàn customer.

### S-05 — low — Trường lạ bị strip thay vì reject

- Vị trí: `packages/contracts/src/index.ts:164` và các input dùng z.object.
- Tái hiện: probe `unknown input fields`, thêm organizationId và ownerUserId vào changeStage.
- Mong đợi theo góc kiểm tra phase: 422 trường ngoài schema. Thực tế: 200, trường lạ bị bỏ; owner vẫn u-lan. Không chứng minh mass assignment hay nâng quyền.
- Nguồn: phase 02 góc 3 và ADR-005 shared schema. Cần coordinator xác nhận strict rejection có phải contract cần giữ trước plan sửa.

### S-06 — medium — Account owners subquery không lọc scope

- Vị trí: `apps/crm/src/worker/queries.ts:318`.
- Tái hiện: probe `shared account owners`, cho lead-10 cùng account acc-4 của lead-04, Sale đọc /accounts.
- Mong đợi: owners chỉ từ lead được phép xem. Thực tế: owners có tên owner ngoài team, dù leadCount/pipeline dùng scope. Account detail vẫn lọc contact/activity theo lead có quyền.
- Nguồn: permission matrix: ownership một Deal không tự cho xem toàn Account. Fixture tổng hợp shared account nằm trong cùng org.

### S-07 — medium — Hai yêu cầu chuyển owner tạo hai approval pending

- Vị trí: `apps/crm/src/worker/commands.ts:385`, `commands.ts:388`.
- Tái hiện: probe `concurrent owner requests`, Promise.all hai requestOwnerChange lead-08/version 1, cùng payload nhưng key khác.
- Mong đợi: chỉ một pending; yêu cầu còn lại bị từ chối theo kiểm tra existing pending trong handler. Thực tế: cả hai 200 và có hai pending; không guard version Lead và không unique pending constraint.
- Nguồn: invariant của handler requestOwnerChange; ADR-003 không dùng pre-read thay lock. Đây là test local có hai call cụ thể, không phải stress hoặc bằng chứng remote scheduling.

### S-08 — low — Schema chỉ kiểm Next Action non-null

- Vị trí: `apps/crm/migrations/0001_init.sql:112`, `0001_init.sql:126`.
- Tái hiện: probe `next action`, UPDATE lead-04 next_action_task_id='ghost' trên D1 test.
- Mong đợi theo comment/QĐ13: task tồn tại, open, đúng lead/owner. Thực tế: UPDATE thành công vì không FK/check quan hệ; non-null thỏa CHECK.
- Nguồn: ERD/QĐ13 Forced Next Action. Đây là giới hạn phòng vệ ở schema, chưa chứng minh command HTTP hiện tại tạo pointer ghost; command happy path giữ pointer/task hợp lệ.

### S-09 — medium — Owner tự duyệt agent Lost proposal

- Vị trí: `apps/crm/src/worker/commands.ts:406`, `commands.ts:423`.
- Tái hiện: probe `agent Lost proposal`, fixture apv-2 có payload lost/price; owner u-lan decideApproval approve.
- Mong đợi: Leader đúng team duyệt mark_lost của agent. Thực tế: 200 approved, lead-06 chuyển lost; quyền approve không phân biệt stage thường với Lost/Won.
- Nguồn: action-risk matrix mark_lost/mark_won. Fixture mô phỏng proposal đã lưu; bản hiện tại không có endpoint nhận proposal agent nên không khẳng định đường tạo proposal ngoài API.

### S-10 — low — Search dài gây 500

- Vị trí: `apps/crm/src/worker/queries.ts:91`, `index.ts:42`.
- Tái hiện: dưới cùng fixture, app.fetch GET /api/leads?q= + 'x'.repeat(2000), header X-Demo-User=u-lan, DEMO_MODE=1.
- Mong đợi: 422 giới hạn input hoặc 200 scoped search. Thực tế: 500 INTERNAL; log nội bộ là LIKE or GLOB pattern too complex. Admin không có rows nên cùng input có thể 200: kiểm input không được phụ thuộc quyền hay dữ liệu.
- Nguồn: phase 02 góc 3, ADR-005 không trả raw DB error. Client không nhận SQL/stack; lỗi validation/availability theo request vẫn tồn tại.

## Kết luận góc kiểm tra 1–8

| Góc | Kết luận |
| --- | --- |
| 1. Auth | Thiếu/unknown/disabled actor và DEMO_MODE khác 1 đều 401; roster demo loại disabled, tắt demo trả 403; health public có chủ đích. Không audit demo header như lỗi auth production. |
| 2. IDOR | Main reads/writes deny ngoài scope; S-01/02/06 là lỗi projection/capability. Head khác department và BGĐ khác org có test fixture riêng. |
| 3. Input/query | Negative version, ID/text dài, invalid date text, malformed JSON, key thiếu/dài bị 422; SQL payload và wildcard không mở scope. S-05/10; không đo tải hay mọi date rollover. Pagination/tab bị bỏ qua, không có contract phân trang. |
| 4. Error | Lỗi giữa outbox batch trả generic 500, không SQL/stack; S-02 vẫn tiết lộ dữ liệu scoped. Không coi console SQL diagnostic là response HTTP. |
| 5. Idempotency | Same actor same body replay không ghi; khác body/command conflict; key lỗi stale chưa được ghi, retry hợp lệ thành công; S-03/04 còn lệch ADR. |
| 6. Guard | Missing/stale/middle failure rollback lead/activity/audit/outbox/idempotency; hai batch cùng version đúng một thắng; guard luôn rỗng sau commit/rollback. S-07 ở command approval không guard lead. |
| 7. Schema | CHECK active-next-action, queue-owner, lost-reason; FK owner; unique lead code/tax code đều bị reject. S-08; chưa xác minh composite same-org FK trên mọi bảng. |
| 8. Audit/outbox | Tám command ghi audit đúng actor/entity, before/after và event/idempotency trong batch; approve compound có test gốc. Outbox hiện không lưu actor riêng, chỉ payload domain; không tuyên bố actor provenance tự đủ nếu tách khỏi audit. |

## Checks, giới hạn và bàn giao

- Baseline: `pnpm -F @abm/crm test`, exit 0, 20/20 (10:46). Test hẹp cuối: `pnpm -F @abm/crm test -- test/security-api.test.ts test/security-integrity.test.ts`, exit 0, 41/41, 3.38s (11:00).
- Combined: `pnpm -F @abm/crm test`, exit 0, 110/110, 6 files, 5.52s (10:57); gồm 41 security, 20 gốc và 49 domain của worker phase 01 tại thời điểm chạy.
- `pnpm -F @abm/crm typecheck`: exit 0 sau sửa annotation projection.after thành object. Lượt trước đã báo TS2345 ở assertion mới, không phải lỗi sản phẩm.
- Điều tra: 9 probe đỏ (exit 1) xác nhận S-01–09; probe audit/cross-actor được chạy lại để kiểm đủ role và cùng command. Search dài fail riêng xác nhận S-10. Test unique ban đầu sai acc-04 (không có row) đã sửa acc-4; không coi là product finding.
- Correction tooling: D1 từ chối CREATE TEMP TRIGGER (SQLITE_AUTH); CREATE TRIGGER trên DB test cô lập + DROP trong finally đã chạy pass fault-injection HTTP rollback. Không có tooling gap còn mở.
- Chỉ thêm `security-api.test.ts`, `security-integrity.test.ts`, báo cáo này và `phase-02-progress.md`; không commit, không sửa product/config/lock/shared plan. Không journal riêng theo Orca approval.
- Test sử dụng D1 ephemeral của cloudflare Vitest (`remoteBindings:false`), seed tổng hợp và môi trường isolated; không migration/data change trên DB dev/remote, không cần khôi phục dữ liệu thật. Không tạo dev server hoặc background process.
- Review inline trên source cuối; không tự mở thêm orchestration/team. Không chạy coverage vì không có threshold repository và đây là audit theo risk; không suy coverage % từ số test.
- Chưa kiểm remote concurrency/restore, Access/Lark/MCP, expired/hash-bound approval hay kill switch vì chưa có đường triển khai tương ứng trong worker này. Không thay thế các gate production bằng local pass.
- Không có blocker cho delivery phase; các finding cần phase 04 đối chiếu rồi plan sửa riêng.

## Packet tái hiện

Các probe dưới đây đã chạy trên Vitest/D1 cô lập và cho kết quả đỏ; không giữ chúng trong suite giao nộp theo quyết định của plan. Để tái hiện, sao chép security-integrity.test.ts thành security-repro.test.ts trong apps/crm/test, nối block này vào bản sao, chạy từ D:/TQD/CRM: pnpm -F @abm/crm test -- test/security-repro.test.ts -t probe, rồi xóa bản sao. Không chạy trên database dev hoặc remote.

~~~ts
test('probe audit capability stays denied until granted', async () => {
  const statuses = [];
  for (const user of ['u-hung', 'u-head', 'u-bgd', 'u-admin']) {
    const res = await app.fetch(new Request('http://crm.test/api/audit', { headers: { 'X-Demo-User': user } }), { ...env, DEMO_MODE: '1' });
    statuses.push(res.status);
  }
  expect(statuses).toEqual([403, 403, 403, 403]);
});
test('probe duplicate details do not disclose foreign leads', async () => {
  const res = await cmd('u-lan', 'createLead', { contactName: 'Test', phone: '0900100010', source: 'self', needSummary: 'Test', nextAction });
  expect(res.json.error?.details ?? []).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'L-0010' })]));
});
test('probe same idempotency key conflicts across actors', async () => {
  await cmd('u-lan', 'logActivity', { leadId: 'lead-04', expectedVersion: 1, type: 'note', summary: 'test' }, 'shared-key');
  const res = await cmd('u-hung', 'logActivity', { leadId: 'lead-05', expectedVersion: 1, type: 'note', summary: 'test' }, 'shared-key');
  expect(res.json.error?.code).toBe('IDEMPOTENCY_CONFLICT');
});
test('probe replay rechecks target scope after reassignment', async () => {
  const body = { leadId: 'lead-04', expectedVersion: 1, type: 'note', summary: 'test' };
  await cmd('u-lan', 'logActivity', body, 'replay-key');
  expect((await cmd('u-hung', 'assignLead', { leadId: 'lead-04', expectedVersion: 2, ownerUserId: 'u-long' })).json.ok).toBe(true);
  const res = await cmd('u-lan', 'logActivity', body, 'replay-key');
  expect(res.status).toBe(404);
});
test('probe unknown input fields are rejected', async () => {
  const res = await cmd('u-lan', 'changeStage', { ...stage, organizationId: 'foreign', ownerUserId: 'u-huy' });
  expect(res.status).toBe(422);
});
test('probe shared account owners stay scoped', async () => {
  await db.prepare("UPDATE lead SET account_id='acc-4' WHERE id='lead-10'").run();
  const res = await app.fetch(new Request('http://crm.test/api/accounts', { headers: { 'X-Demo-User': 'u-lan' } }), { ...env, DEMO_MODE: '1' });
  const json = await res.json() as any;
  const owner = (await row('app_user', 'u-huy'))!.display_name;
  expect(json.data.find((a: any) => a.id === 'acc-4').owners).not.toContain(owner);
});
test('probe concurrent owner requests cannot duplicate pending approval', async () => {
  const body = { leadId: 'lead-08', expectedVersion: 1, toUserId: 'u-long', reason: 'test' };
  const results = await Promise.all([cmd('u-lan', 'requestOwnerChange', body), cmd('u-lan', 'requestOwnerChange', body)]);
  const n = await db.prepare("SELECT COUNT(*) n FROM approval WHERE lead_id='lead-08' AND kind='owner_change' AND status='pending'").first<{ n: number }>();
  expect(n!.n).toBe(1);
});
test('probe next action cannot point to a nonexistent task', async () => {
  await expect(db.prepare("UPDATE lead SET next_action_task_id='ghost' WHERE id='lead-04'").run()).rejects.toThrow();
});
test('probe agent Lost proposal requires team leader approval', async () => {
  await db.prepare('UPDATE approval SET payload_json=? WHERE id=?').bind(JSON.stringify({ toStage: 'lost', lostReason: 'price' }), 'apv-2').run();
  const res = await cmd('u-lan', 'decideApproval', { approvalId: 'apv-2', expectedVersion: 1, decision: 'approve' });
  expect(res.status).toBe(403);
});

test('probe long search does not cause a database error', async () => {
  const res = await app.fetch(new Request('http://crm.test/api/leads?q=' + 'x'.repeat(2000), { headers: { 'X-Demo-User': 'u-lan' } }), { ...env, DEMO_MODE: '1' });
  expect(res.status).not.toBe(500);
});
~~~

## Câu hỏi còn mở

S-05 cần strict reject hay chấp nhận strip; outbox cần actor trực tiếp hay truy xuất qua audit. Đây là quyết định cho plan sửa sau phase 04, không cản delivery audit.
