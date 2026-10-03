# Decision pack nghiệp vụ ABM CRM v1

Ngày soạn: 2026-10-03. Phạm vi: MVP0, chuẩn bị MVP1 và mô hình v0 cho MVP2.
QĐ1–QĐ9 và QĐ11–QĐ14 được user duyệt ngày 2026-10-03 qua coordinator; QĐ10 chờ ADR. Quyết định trước đó được giữ nguyên theo [plan](../../plans/261003-2239-abm-crm-foundation-poc/plan.md#quyết-định-đã-chốt-không-mở-lại) và [xác nhận user](../../plans/reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md#quyết-định-user-ngày-03102026).
Câu trả lời và các chi tiết user cho phép bổ sung sau nằm trong [open-questions.md](open-questions.md).

## QĐ1 Pipeline MVP

Trạng thái: ĐÃ CHỐT [DECIDED] — pipeline và thứ tự stage.
Nội dung: B2B/Inhouse; Lead mới → Đã liên hệ → Tiềm năng → Tư vấn → Báo giá → Đàm phán → Chờ chốt → Won/Lost.
Nguồn: [PRD 10.1–10.6](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#10-module-3--sales-pipeline-activity--follow-up), [quyết định user](../../plans/reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md#quyết-định-user-ngày-03102026).

Trạng thái chi tiết: ĐÃ CHỐT [DECIDED].
Lost bắt buộc reason; danh mục theo PRD: Giá; Không đúng nhu cầu; Không đúng thời điểm; Không đủ ngân sách; Đối thủ; Không tiếp cận đúng Decision Maker; Không Follow-up kịp; Không phản hồi; Khác (kèm giải thích).

Stage Definition v0 dưới đây đã duyệt. SLA theo ngày làm việc: Đã liên hệ 3, Tiềm năng 7, Tư vấn 7, Báo giá 5, Đàm phán 10, Chờ chốt 7; quá hạn nhắc Owner rồi Leader. Lead mới áp first-contact SLA 4 giờ làm việc; sau 24 giờ làm việc chưa liên hệ, Leader quyết định nhả. Giờ làm việc 08:00–17:30 Asia/Ho_Chi_Minh; Won/Lost là terminal, không áp stage SLA active. Lịch ngày làm việc/ngày nghỉ cần cấu hình trước vận hành, không tự suy ra từ khung giờ.

| Stage | Entry và trường bắt buộc | Activity và exit | Auto Task / Notification / Approval |
| --- | --- | --- | --- |
| Lead mới | Nhu cầu đầu vào, nguồn, Contact/Account khi có, Owner, Next Action, Deadline | Ghi nhận liên hệ đầu tiên để sang Đã liên hệ | Task liên hệ; nhắc owner/Leader khi quá SLA; đổi stage cần duyệt nếu agent |
| Đã liên hệ | Có Activity liên hệ và kết quả | Xác định nhu cầu để sang Tiềm năng | Task đánh giá nhu cầu; nhắc theo SLA; đổi stage cần duyệt nếu agent |
| Tiềm năng | Nhu cầu được qualified, liên kết Deal và Contact/Account | Xác nhận mục tiêu và người quyết định để sang Tư vấn | Task tư vấn; nhắc theo SLA; đổi stage cần duyệt nếu agent |
| Tư vấn | Nội dung tư vấn và sản phẩm quan tâm | Có phạm vi và đề xuất giá để sang Báo giá | Task lập báo giá; nhắc theo SLA; đổi stage cần duyệt nếu agent |
| Báo giá | Reference/version báo giá và giá trị đề xuất | Ghi phản hồi khách để sang Đàm phán | Task follow-up báo giá; gửi ra ngoài cần duyệt đối với agent |
| Đàm phán | Activity đàm phán và điều khoản đang trao đổi | Điều khoản thống nhất để sang Chờ chốt | Task chốt điều khoản; giảm giá vượt quyền cần duyệt |
| Chờ chốt | Điều khoản, giá trị dự kiến, người quyết định | Có bằng chứng chốt hoặc lý do Lost | Task xác nhận kết quả; agent chuyển Won/Lost cần duyệt |
| Won | Bằng chứng chốt và giá trị Deal | Kết thúc sales; handover theo QĐ7, không đồng nghĩa đã thu tiền | Task handover khi phù hợp; thông báo theo scope |
| Lost | Reason và ghi chú theo quy tắc được duyệt | Kết thúc sales; không bắt buộc Next Action active | Lý do Lost chỉ qua DM trên chat; agent cần duyệt |

## QĐ2 Customer Object Model

Trạng thái: ĐÃ CHỐT [DECIDED].
Nội dung: Account là doanh nghiệp khách, tách Organization nội bộ ABM. Contact là cá nhân, thuộc 0..n Account qua AccountContact; quan hệ có vai trò người quyết định, liên hệ, thanh toán, học viên. Lead là nhu cầu đầu vào gắn Contact/Account; Deal là cơ hội thương mại tạo khi Lead qualified. Một Contact/Account có nhiều Lead/Deal. Customer 360 là view hợp nhất theo Contact/Account, không phải bảng Customer riêng; Won không đổi danh tính khách. Bên mua, người trả tiền và beneficiary được chỉ rõ, không mặc định là cùng một người.
Nguồn: [PRD 8](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#8-module-1--customer-360--master-data), [PRD 21](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#21-data-model-lõi), [thiết kế data model](../source-package/design/abm-agentic-crm-design.md#các-quyết-định-data-model-cần-khóa).

## QĐ3 Unique Identity

Trạng thái: ĐÃ CHỐT [DECIDED].
Nội dung: Email chuẩn hóa và điện thoại E.164 là tín hiệu trùng, không unique tuyệt đối (email dùng chung, tổng đài, số tái cấp). Mã số thuế unique cho Account khi có; không dùng giá trị rỗng làm khóa chung. Channel identity như Lark open_id unique theo namespace/channel instance và external ID. Hiện record nghi trùng để người có quyền xử lý; không tự xóa/merge.
Nguồn: [PRD 9.2](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#92-duplicate-check), [thiết kế data model](../source-package/design/abm-agentic-crm-design.md#các-quyết-định-data-model-cần-khóa).

## QĐ4 Ownership

Trạng thái: ĐÃ CHỐT [DECIDED].
Nội dung: Owner là người được giao Lead/Deal; ghi Team, Assigned At, Assigned By, Support User và Assignment History. First contact trong 4 giờ làm việc, quá hạn nhắc Owner và báo Leader; sau 24 giờ làm việc chưa liên hệ, Leader quyết định nhả về hàng chờ phòng ban. Giờ làm việc 08:00–17:30 Asia/Ho_Chi_Minh. Sale yêu cầu chuyển owner, Leader duyệt; Sale nghỉ thì Leader phân lại hàng loạt có audit. Support chỉ xem và ghi hoạt động theo scope, không đổi stage. Owner Contact/Account là owner của Deal active gần nhất; Leader xử lý xung đột. Không suy ra quyền toàn doanh nghiệp khách từ ownership một Deal.
Nguồn: [PRD 9.4–9.5](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#94-lead-ownership), [PRD 43 QĐ4](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#quyết-định-4--ownership).

## QĐ5 Role/Permission

Trạng thái: ĐÃ CHỐT [DECIDED] — phạm vi vai trò; ma trận chi tiết được hiện thực tại phase 04.
Nội dung: Sale đọc/sửa Own/Assigned; Leader Team; Department Head Department; BGĐ Organization; Admin quản lý cấu hình. Merge, archive/delete, export, discount, payment confirmation, contract, entitlement override, role management và AI write là quyền riêng, kiểm ở backend. Ma trận sẽ được tạo và duyệt tại phase 04: `docs/security/permission-matrix-v1.md` (chưa tồn tại).
Nguồn: [PRD 23](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#23-phân-quyền-và-bảo-mật), [quyết định user](../../plans/reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md#quyết-định-user-ngày-03102026), [phase 04](../../plans/261003-2239-abm-crm-foundation-poc/phase-04-adr-policy-matrices.md).

Đã chốt: mỗi nhóm Lark là một phòng ban; pipeline phòng ban xem được trong nhóm; hoa hồng, lý do Lost và dữ liệu cá nhân khách chỉ qua DM. Web áp RBAC cá nhân/team. Nhân viên liên kết tài khoản một lần qua DM bot. Agent MVP1 tự ghi hoạt động, tạo việc tiếp/nhắc, tạo lead có kiểm trùng; đổi stage, Won/Lost, owner và mọi gửi ra ngoài phải duyệt. User là admin GoClaw duy nhất. Nhóm nội bộ không có người ngoài công ty. Danh sách phòng ban/nhóm/Leader: chờ danh sách — nộp trước khi lập plan MVP1; user xác nhận không chặn MVP0.

Retention đã chốt: audit ≥ 5 năm; dữ liệu CRM giữ đến khi Admin ẩn danh theo yêu cầu; session/memory GoClaw 90 ngày; backup 30 ngày. Chỉ Admin xóa/ẩn danh; BGĐ duyệt export. Retention riêng cho chat nguồn/file ngoài CRM chưa có thời hạn riêng được xác nhận, không suy ra quyền thay đổi nguồn ngoài từ chính sách CRM.

## QĐ6 Product/Entitlement

Trạng thái: ĐÃ CHỐT [DECIDED].
Nội dung: User duyệt Entitlement Model v0 cho MVP0; Product Master mẫu thật và quyền lợi mẫu được user cho phép cung cấp trước khi lập plan MVP2. Product version và OrderLine snapshot bảo toàn cam kết đã bán. Không tạo sản phẩm giả thay mẫu user.
Nguồn: [PRD 11](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#11-module-4--product-pricing--sales-knowledge), [PRD 15](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#15-module-8--entitlement--membership-management), [PRD 36.7](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#367-entitlement-generation).

Product Master mẫu chờ user cung cấp các giá trị thực trước khi lập plan MVP2 (được user duyệt hoãn, không chặn MVP0):

| Trường | Giá trị |
| --- | --- |
| Mã sản phẩm | Chờ user |
| Tên | Chờ user |
| Loại (Course/Service/Membership/Digital Product/Bundle) | Chờ user |
| Giá niêm yết và tiền tệ | Chờ user |
| Version | Chờ user |
| Ngày hiệu lực | Chờ user |
| Entitlement Template và điều kiện thanh toán | Chờ user |

Các metadata mở rộng theo PRD 11.1 gồm Family, Segment, Problem Solved, Outcome, Delivery Model, Timeline, Price Policy, Sales Content và Status; giá trị cho sản phẩm mẫu bổ sung trước plan MVP2.

Template gắn product version. Entitlement sinh từ OrderLine khi đủ điều kiện thanh toán riêng của sản phẩm đã được nguồn kế toán xác nhận; không dùng Won làm bằng chứng thu. Entitlement có Customer/Account, beneficiary Contact, nguồn OrderLine, product version/template, type, quantity, start/due/expiry, owner, status, fulfillment evidence và notes. Trạng thái theo PRD 15: Pending, Activated, Partially Fulfilled, Fulfilled, Expired, Cancelled. Sinh một lần theo OrderLine/template/beneficiary, không nhân đôi khi replay. Số lượng, hạn và điều kiện kích hoạt của mẫu chờ user.

## QĐ7 Handover

Trạng thái: ĐÃ CHỐT [DECIDED].
Nội dung: Handover Schema v0 bảo toàn thông tin Sale → Delivery. Tạo từ Deal Won, khi Payment đủ điều kiện hoặc Leader chủ động; trigger không tự cho phép Complete.
Nguồn: [PRD 13.3–13.5](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#133-handover-case), [PRD 36.6](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#366-handover-gate).

| Trường PRD 13.3 | Bắt buộc v0 đã duyệt |
| --- | --- |
| Customer (Account/Contact) | Có |
| Contact chính | Có |
| Product/version | Có |
| Deal | Có |
| Contract | Khi giao dịch có hợp đồng; ngoại lệ phải nêu rõ |
| Payment Status | Có, kèm provenance QĐ8 |
| What Was Sold | Có |
| Deliverables | Có |
| Commitments | Có; ghi rõ không có nếu không phát sinh |
| Entitlements | Có, từ template/snapshot |
| Number of Learners | Khi sản phẩm đào tạo |
| Date/Timeline | Có |
| Location | Khi triển khai cần địa điểm |
| Special Requests | Có mục ghi nhận; ghi rõ không có nếu không phát sinh |
| Sale Owner | Có |
| Delivery Owner | Có |
| Notes | Tùy chọn |

Chín trường được PRD 36.6 nêu làm ví dụ mandatory đã có trong bảng: Customer, Contact chính, Product, Nội dung đã bán, Cam kết, Quyền lợi, Timeline, Payment Status, Delivery Owner. User đã duyệt bảng mandatory và điều kiện áp dụng v0; hoàn thiện chi tiết trước MVP2. Chặn Complete nếu thiếu trường bắt buộc; sau Complete mọi thay đổi có Change Request, old/new value, requester, approver, timestamp và reason. Leader phòng ban duyệt ngoại lệ và Change Request sau Complete.

## QĐ8 Payment

Trạng thái: ĐÃ CHỐT [DECIDED].
Nội dung: MISA AMIS Kế toán là nguồn thực thu chính thức; bảng kế toán duyệt dùng import/đối soát. CRM chỉ giữ PaymentReference, không ghi sổ hay xác nhận thu từ chat. Có mapping mã khách/chứng từ với Account/Order, source ID, external transaction ID, timestamp, confirmer, import batch/version và reconciliation status. Đối soát từng giao dịch, không cộng lặp MISA và bảng duyệt; sửa/hủy chứng từ phải được đối chiếu trước cập nhật reference/downstream. Quyền và coverage API chỉ kết luận sau phase 07; chưa đủ API thì import file kế toán xuất/duyệt. Phân biệt booked, forecast, cash collected và receivable reference.
Nguồn: [PRD 12.5](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#125-payment-reference), [thiết kế SoR](../source-package/design/abm-agentic-crm-design.md#system-of-record-và-privacy), [plan](../../plans/261003-2239-abm-crm-foundation-poc/plan.md#quyết-định-đã-chốt-không-mở-lại).

## QĐ9 System of Record

Trạng thái: ĐÃ CHỐT [DECIDED] — ranh giới Write Master theo thiết kế và quyết định nguồn; cutover cụ thể chờ inventory QĐ11.
Nội dung: Mỗi loại dữ liệu có một Write Master. CRM giữ reference tới dữ liệu thuộc nguồn khác, không tạo multi-master.
Nguồn: [PRD 22](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#22-system-of-record), [thiết kế System of Record](../source-package/design/abm-agentic-crm-design.md#system-of-record-và-privacy).

| Dữ liệu | Write Master / ranh giới |
| --- | --- |
| Customer/CRM/Sales/Task/Handover/Entitlement | ABM core |
| Thực thu chính thức | MISA; bảng kế toán quản lý đã xác nhận phục vụ import/đối chiếu; core giữ reference |
| Tài liệu chính thức | Drive/kho file chuẩn; core giữ metadata approved/version/access |
| Program/CS | Notion/hệ cũ trước từng cutover; ABM sau verified migration |
| Message nguồn | Kênh hoặc archive chuẩn theo retention; core giữ timeline/reference theo quyền |
| Session/memory/trace agent | GoClaw; không phải nguồn nghiệp vụ chuẩn |
| Chat nội bộ | Lark là nguồn, CRM giữ timeline/reference; GoClaw giữ session/memory, không phải nguồn nghiệp vụ |

Retention và quyền xóa/ẩn danh/export áp theo QĐ5; không ingest toàn bộ hội thoại chỉ vì có thể. User xác nhận bảng SoR và không có nguồn nghiệp vụ bổ sung.

## QĐ10 Stack

Trạng thái: ĐỀ XUẤT — chờ duyệt [PROPOSED] — chờ ADR phase 04.
Nội dung: Cloudflare Workers + D1 + R2 + Queues + Cron, Hono, Drizzle, React PWA. Hạ tầng CRM trên Cloudflare và GoClaw ngoài core đã chốt; framework, auth, write pattern, trusted actor và command contracts cần ADR và bằng chứng PoC. Chưa coi đề xuất này là ADR accepted.
Nguồn: [thiết kế triển khai](../source-package/design/abm-agentic-crm-design.md#ánh-xạ-triển-khai-cloudflare), [phase 04](../../plans/261003-2239-abm-crm-foundation-poc/phase-04-adr-policy-matrices.md), [plan](../../plans/261003-2239-abm-crm-foundation-poc/plan.md#quyết-định-đã-chốt-không-mở-lại).

## QĐ11 Migration Scope

Trạng thái: ĐÃ CHỐT [DECIDED].
Nội dung: Lark chỉ dùng chat, Lark Base không có dữ liệu cần migrate. MVP1 chỉ migrate khách hàng active và pipeline active từ Google Sheet; lịch sử, Notion và Zalo archive/read-only. MVP0 không migrate dữ liệu thật. Inventory file/owner cụ thể cần chuẩn bị khi lập kế hoạch migration, không tự tạo nguồn.
Nguồn: [PRD 41](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#41-migration-từ-notion--sheet--zalo), [quyết định user](../../plans/reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md#quyết-định-user-ngày-03102026).

Trạng thái phạm vi: ĐÃ CHỐT [DECIDED]. Giữ tài liệu/SOP/knowledge trên Notion/Drive; không migrate big bang. Chỉ cutover sau module ổn, migration verified, hướng dẫn người dùng, rollback plan và Write Master rõ.

## QĐ12 Danh mục nguồn Lead

Trạng thái: ĐÃ CHỐT [DECIDED].
Nội dung: Nguồn active: Facebook, Zalo, Website, Landing Page, Form, Referral, Partner, Sale Self-Sourced. Nguồn inactive: Email, Event, Webinar, Offline, Import, API. Đây là danh mục nguồn theo PRD 9.1, không thay quyền dùng công cụ import migration đã duyệt. Lưu First Source/Latest Source và campaign/UTM khi có.
Nguồn: [PRD 9.1](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#91-nguồn-lead), [PRD 34.2](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#342-deliverables-business).

## QĐ13 Quy tắc Next Action

Trạng thái: ĐÃ CHỐT [DECIDED].
Nội dung: Lead/Deal active bắt buộc Owner + Next Action + Deadline. Hoàn thành Next Action phải tạo Next Action mới trong cùng thao tác trừ chuyển Won/Lost. Tạm hoãn cần lý do, ngày mở lại và Leader duyệt; không để record active mất việc tiếp. NextAction trỏ Task còn hiệu lực trong một Task engine, không duy trì deadline/owner độc lập ở hai nơi.
Nguồn: [PRD 10.4](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#104-forced-next-action), [PRD 19](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#19-module-12--task-workflow-dashboard-automation--governance), [thiết kế data model](../source-package/design/abm-agentic-crm-design.md#các-quyết-định-data-model-cần-khóa).

## QĐ14 Data Distribution Policy

Trạng thái: ĐÃ CHỐT [DECIDED].
Nội dung: Lead mới vào hàng chờ phòng ban; Leader phân thủ công ở MVP1. Hàng chờ intake chưa giao được phân biệt với Lead active; sau phân phải có Owner + Next Action + Deadline theo QĐ13. Round Robin tắt trong MVP1. Ghi audit assignment/reassignment và scope phòng ban. Phòng ban, nhóm Lark và Leader: chờ danh sách — nộp trước khi lập plan MVP1; user xác nhận không chặn MVP0.
Nguồn: [PRD 9.3](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#93-lead-distribution), [PRD 34.2](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#342-deliverables-business), [quyết định chat](../../plans/reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md#cập-nhật-2223--kênh-chat-là-lark-mỗi-nhóm-là-một-phòng-ban).

## Exit gate MVP0

Nguồn: [PRD 34.6](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md#346-exit-gate-mvp-0). Đây là câu trả lời hiện tại, không phải tuyên bố MVP0 đã pass.

| # | Câu hỏi | Câu trả lời và bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| 1 | Object trung tâm là gì? | Contact/Account là danh tính; Customer 360 là view, QĐ2 | ĐẠT |
| 2 | Customer–Contact–Company–Lead–Deal quan hệ ra sao? | AccountContact nhiều-nhiều; Lead intake, Deal qualified; Organization nội bộ riêng, QĐ2 | ĐẠT |
| 3 | Pipeline MVP là pipeline nào? | B2B/Inhouse, Stage Definition và SLA QĐ1 | ĐẠT |
| 4 | Sale được xem dữ liệu nào? | Web Own/Assigned; nhóm pipeline phòng ban, PII/hoa hồng/Lost qua DM, QĐ5 | Scope đã duyệt; ma trận phase 04 còn phải tạo |
| 5 | Lead được giao/chuyển/nhả ra sao? | Leader phân thủ công; Sale yêu cầu/Leader duyệt chuyển; first contact 4 giờ, Leader quyết định nhả sau 24 giờ làm việc, QĐ4/14 | ĐẠT; danh sách phòng ban trước plan MVP1 |
| 6 | Dữ liệu nào là nguồn sự thật? | Bảng Write Master QĐ9, Google Sheet active migrate MVP1, QĐ11 | ĐẠT; inventory cụ thể khi lập migration |
| 7 | Handover bắt buộc những gì? | Bảng mandatory và change control do Leader duyệt, QĐ7 | ĐẠT — chốt chi tiết trước MVP2 |
| 8 | Entitlement được sinh thế nào? | OrderLine snapshot/template/beneficiary, payment condition, chống trùng QĐ6 | ĐẠT — chốt chi tiết và mẫu thật trước plan MVP2 |
| 9 | Payment thực thu lấy từ đâu? | MISA AMIS; bảng kế toán duyệt import/đối soát; CRM giữ reference, QĐ8 | Đã chốt; coverage phase 07 |
| 10 | Stack/Architecture đã có ADR chưa? | Cloudflare đã chốt; QĐ10 chờ ADR phase 04 và PoC | Chưa có ADR accepted |

Deliverables PRD 34.2 được ánh xạ: Pipeline/Stage/Lost → QĐ1; Ownership/chuyển/nhả → QĐ4; Distribution → QĐ14; Customer Model → QĐ2; Product Master/Entitlement → QĐ6; Handover → QĐ7; Role/Permission → QĐ5 (phase 04); SoR → QĐ9; Nguồn Lead → QĐ12; Duplicate → QĐ3; Next Action → QĐ13. User duyệt model v0 và cho phép mẫu sản phẩm thật bổ sung trước plan MVP2; ma trận và ADR phase 04 vẫn phải hoàn thành, không coi phase 02 là toàn bộ MVP0 exit gate đã pass.

## Phê duyệt

Đã duyệt bởi user: ABM — 2026-10-03 [APPROVED]

Coordinator chuyển câu trả lời thật của user trong message `msg_c6264a19d1a1`, task `task_8327412750e8`, dispatch `ctx_dfd458bbac12`. Phê duyệt QĐ1–QĐ9/QĐ11–QĐ14; QĐ10 chờ ADR phase 04. User cho phép danh sách phòng ban bổ sung trước plan MVP1 và mẫu sản phẩm/quyền lợi thật trước plan MVP2.
