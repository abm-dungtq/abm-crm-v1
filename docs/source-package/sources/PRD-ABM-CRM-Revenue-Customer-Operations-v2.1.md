# PRD v2.1 — ABM REVENUE & CUSTOMER OPERATIONS SYSTEM

> **Tên ngắn:** ABM CRM  
> **Định vị:** Hệ điều hành Khách hàng – Doanh thu – Triển khai – Chăm sóc của ABM  
> **Phiên bản:** 2.1  
> **Trạng thái:** Product Requirement Document — Kiến trúc đích + Lộ trình MVP  
> **Đối tượng đọc:** Ban Lãnh đạo · Sale · CSKH · Tổ chức · Marketing · Kế toán · Kỹ thuật · Đội phát triển sản phẩm  
> **Nguyên tắc:** Brain First – A.I Second · Làm 1 dùng N · Internal First · Safe Vibe Coding

---

# MỤC LỤC

1. Bối cảnh và bài toán
2. Mục tiêu sản phẩm
3. Chiến lược 3-trong-1 của ABM
4. Nguyên tắc thiết kế
5. Phạm vi và ranh giới
6. Người dùng và vai trò
7. Kiến trúc nghiệp vụ đích
8. Module 1 — Customer 360 & Master Data
9. Module 2 — Lead Intake, Distribution & Governance
10. Module 3 — Sales Pipeline, Activity & Follow-up
11. Module 4 — Product, Pricing & Sales Knowledge
12. Module 5 — Proposal, Contract, Order & Payment Reference
13. Module 6 — Sale → Delivery Handover
14. Module 7 — Program & Training Operations
15. Module 8 — Entitlement & Membership Management
16. Module 9 — Customer Success & Support
17. Module 10 — Retention, Upsell, Cross-sell & Referral
18. Module 11 — OmniChannel & Customer Interaction
19. Module 12 — Task, Workflow, Dashboard, Automation & Governance
20. A.I Copilot, A.I Agent và MCP
21. Data Model lõi
22. System of Record
23. Phân quyền và bảo mật
24. Audit, Backup, Restore và vận hành
25. Privacy by Design
26. Tích hợp
27. Mobile và trải nghiệm người dùng
28. Vibe Coding Engineering Guardrails
29. Kiến trúc kỹ thuật định hướng
30. Nguyên tắc Config-Lite
31. Definition of Done tổng thể
32. KPI đánh giá hệ thống
33. Lộ trình MVP theo Capability Ladder
34. MVP 0 — Foundation
35. MVP 1 — CRM Core Vertical Slice
36. MVP 2 — Revenue → Handover → Entitlement
37. MVP 3 — Program Operations & Customer Success
38. MVP 4 — OmniChannel & Automation
39. MVP 5 — A.I & Digital Workforce
40. Exit Gate giữa các bậc
41. Migration từ Notion/Sheet/Zalo
42. Tài sản đào tạo và chuyển giao
43. Các quyết định phải chốt trước khi code
44. Backlog ưu tiên
45. Kết luận

---

# 1. BỐI CẢNH VÀ BÀI TOÁN

ABM không chỉ có nhu cầu “quản lý khách hàng” theo nghĩa CRM truyền thống.

Bài toán thực tế xuyên suốt:

**Marketing → Lead → Sale → Tư vấn → Báo giá → Đàm phán → Hợp đồng → Thanh toán → Bàn giao → Tổ chức/Triển khai → Quyền lợi → CSKH → Khách hàng cũ → Upsell/Cross-sell/Referral → Quản trị.**

Các điểm nghẽn cốt lõi:

- Dữ liệu khách hàng phân tán giữa CRM cũ, Sheet, Zalo, Drive, Notion và trí nhớ cá nhân.
- Không có Customer 360 duy nhất.
- Lead Ownership chưa đủ rõ.
- Sale dễ bỏ quên Follow-up.
- Pipeline chưa được quản trị bằng tiêu chí và SLA rõ ràng.
- Sale phải hỏi lại nhiều người khi cần thông tin sản phẩm, giá, quyền lợi hoặc chính sách.
- Deal sau khi chốt chưa được nối chặt sang Handover – Delivery – Entitlement.
- Quyền lợi học viên/khách hàng có thể bị bỏ sót hoặc quá hạn.
- Tổ chức chương trình còn phụ thuộc vào Checklist phân tán và kinh nghiệm cá nhân.
- Lịch giảng viên, Zoom, kỹ thuật, Media, địa điểm, nhân sự có nguy cơ xung đột.
- CSKH chưa được vận hành thành hành trình chủ động.
- Khách hàng cũ chưa được quản trị thành nguồn doanh thu riêng.
- Dashboard giữa Sale – Leader – BGĐ – Tổ chức chưa thống nhất.
- A.I chưa có một nền dữ liệu và Workflow đủ chuẩn để tham gia sâu.
- Tri thức có thể mất khi nhân sự nghỉ việc hoặc thay đổi vị trí.

Bài toán do đó không phải:

> **“Xây một phần mềm CRM.”**

Mà là:

> **Xây một hệ điều hành Khách hàng – Doanh thu – Triển khai – Chăm sóc, nơi con người và A.I cùng làm việc trên một nguồn dữ liệu và một Workflow thống nhất.**

---

# 2. MỤC TIÊU SẢN PHẨM

ABM Revenue & Customer Operations System phải:

1. Tạo một nguồn sự thật thống nhất về khách hàng.
2. Chuẩn hóa Lead Ownership và Pipeline.
3. Bắt buộc mọi khách hàng active có Next Action.
4. Nối Sale với hợp đồng, thanh toán, bàn giao và triển khai.
5. Theo dõi đầy đủ quyền lợi/cam kết với từng khách hàng.
6. Quản trị chương trình đào tạo/triển khai bằng Workflow.
7. Quản trị CSKH, khách cũ, Upsell, Cross-sell và Referral.
8. Cung cấp Dashboard đúng vai trò.
9. Cho phép Automation theo quy tắc.
10. Tạo nền tảng dữ liệu để A.I Copilot/Agent làm việc an toàn.
11. Trở thành case study thực chiến cho chương trình đào tạo ABM.
12. Có thể tái triển khai cho một số doanh nghiệp tương đồng mà không phải xây lại lõi.

---

# 3. CHIẾN LƯỢC 3-TRONG-1 CỦA ABM

## 3.1. Đầu ra 1 — Hệ vận hành nội bộ

Giải quyết các điểm nghẽn thật của ABM.

Ưu tiên hiệu quả vận hành trước tính “đẹp để demo”.

## 3.2. Đầu ra 2 — Tài sản đào tạo

Toàn bộ quá trình phải có khả năng chuyển thành:

- Case study.
- Giáo án.
- Demo.
- Bài tập.
- Checklist.
- Template.
- SOP.
- Video.
- Bộ Prompt/Skill.
- Bộ bài học vibe coding thực chiến.

Các năng lực có thể đóng gói để đào tạo:

- Phân tích bài toán.
- Thiết kế Data Model.
- Xây Workflow.
- Phân quyền.
- Vibe coding có kỷ luật.
- Test.
- Backup/Restore.
- A.I Agent trên dữ liệu thật.
- MCP.
- Deployment.
- Kaizen.

## 3.3. Đầu ra 3 — Gói chuyển giao

Không đi theo mô hình SaaS multi-tenant ở giai đoạn này.

Hướng tới:

> **Single-tenant · Repeatable Deployment · Config-Lite**

Có thể triển khai cùng codebase cho doanh nghiệp khác bằng:

- Bộ cấu hình.
- Seed Data.
- Product Catalog.
- Pipeline.
- Permission Matrix.
- Entitlement Types.
- Notification Rules.
- Branding.

---

# 4. NGUYÊN TẮC THIẾT KẾ

## 4.1. Brain First – A.I Second

**Bài toán → Dữ liệu → Quy trình → Vai trò → Hệ thống → Automation → A.I**

Không dùng A.I để che lấp quy trình chưa rõ.

## 4.2. Single Source of Truth

Mỗi loại dữ liệu quan trọng phải có một nguồn ghi chính thức.

Không để nhiều hệ thống cùng là Write Master cho cùng một loại dữ liệu.

## 4.3. Customer Centric

Khách hàng là trục trung tâm.

Các bộ phận không vận hành bằng các “đảo dữ liệu” riêng.

## 4.4. Workflow First

Mỗi tính năng phải nằm trong luồng:

- Trigger.
- Input.
- Owner.
- SLA.
- Action.
- Approval.
- Output.
- Next Step.
- Escalation.

## 4.5. Vertical Slice First

Không triển khai 12 module cùng lúc.

Ưu tiên lát cắt nghiệp vụ chạy trọn vẹn.

Ví dụ:

**Lead mới → phân Sale → liên hệ → Follow-up → Won/Lost → Audit**

## 4.6. Human in the Loop

Các hành động tác động cao cần phê duyệt:

- Giảm giá ngoài chính sách.
- Hoàn tiền.
- Merge/Xóa Customer quan trọng.
- Thay đổi quyền lợi.
- Thay đổi hợp đồng.
- A.I Write Action quan trọng.

## 4.7. Config-Lite

Không xây Full Workflow Builder ở giai đoạn đầu.

Nhưng không hardcode lộn xộn. Những yếu tố thay đổi theo doanh nghiệp phải tách thành config/seed rõ ràng.

## 4.8. Safe Vibe Coding

A.I hỗ trợ sinh code nhanh, nhưng các vùng sau cần kỷ luật kỹ thuật cao:

- Data Model.
- Authentication.
- Authorization.
- Payment Reference.
- Data Migration.
- Audit.
- Backup.
- Restore.
- Privacy.
- Critical Workflow.
- Production Deployment.

---

# 5. PHẠM VI VÀ RANH GIỚI

## 5.1. Trong kiến trúc đích

- Customer 360.
- CRM.
- Sales.
- Handover.
- Program Operations.
- Entitlement.
- Customer Success.
- Retention.
- OmniChannel.
- Task.
- Workflow.
- Automation.
- Dashboard.
- A.I Copilot.
- A.I Agent.
- MCP.
- Audit.
- Security.

## 5.2. Không ưu tiên trong MVP đầu

- Multi-tenant SaaS.
- Marketplace.
- Full HRM.
- Payroll.
- Full Accounting.
- Inventory phức tạp.
- Workflow Builder kéo-thả.
- Custom Field Builder toàn diện.
- Native Mobile App.
- ABAC phức tạp.
- Full BI platform.
- Generic SaaS configuration cho mọi ngành.

## 5.3. Ranh giới tài chính

Ở giai đoạn đầu:

> **CRM không phải Financial Ledger.**

CRM có thể lưu:

- Deal Value.
- Payment Schedule.
- Expected Payment.
- Payment Status.
- Amount Confirmed.
- Outstanding Amount.

Nguồn sự thật của **thực thu/kế toán** vẫn nằm ở hệ thống hoặc dữ liệu tài chính được ABM xác định là chính thức.

---

# 6. NGƯỜI DÙNG VÀ VAI TRÒ

## 6.1. Ban Giám đốc

- Revenue Booked.
- Cash Collected.
- Receivables.
- Forecast.
- Funnel.
- Product Performance.
- Source Performance.
- Team Performance.
- Customer Risk.
- Program Readiness.
- Upsell Opportunity.
- Alert cần quyết định.

## 6.2. Sale Leader

- Team Pipeline.
- Lead Distribution.
- Overdue Follow-up.
- Stale Deals.
- Conversion Rate.
- Deal Support.
- Forecast.
- Coaching Signals.
- Workload.

## 6.3. Sale

- My Leads.
- My Deals.
- Tasks Today.
- Next Action.
- Follow-up.
- Customer 360.
- Product Knowledge.
- Proposal.
- Contract.
- Payment Status.
- Handover.
- KPI.
- Commission Estimate.

## 6.4. CSKH

- Customer 360.
- Entitlement.
- Ticket.
- Complaint.
- Membership.
- Satisfaction.
- Last Contact.
- Next Contact.
- Renewal.
- Upsell/Cross-sell.

## 6.5. Tổ chức/Triển khai

- Program.
- Handover.
- Checklist.
- Instructor.
- Zoom.
- Location.
- Technical.
- Media.
- Learner List.
- Entitlement.
- Deadline.
- Resource Conflict.

## 6.6. Marketing

- Campaign.
- UTM.
- Source.
- Lead.
- Qualified Lead.
- Deal.
- Revenue Attribution.
- Cost/ROI khi dữ liệu cho phép.

## 6.7. Kế toán/Tài chính

- Contract Reference.
- Order.
- Payment Schedule.
- Confirmed Payment.
- Receivable.
- Refund Reference.
- Reconciliation.

## 6.8. Admin

- User.
- Role.
- Permission.
- Team.
- Organization.
- Config.
- Audit.
- Workflow Rules.
- Integration.
- System Settings.

---

# 7. KIẾN TRÚC NGHIỆP VỤ ĐÍCH

Hệ thống đích gồm 12 khối:

1. **Customer 360 & Master Data**
2. **Lead Intake – Distribution – Governance**
3. **Sales Pipeline – Activity – Follow-up**
4. **Product – Pricing – Sales Knowledge**
5. **Proposal – Contract – Order – Payment Reference**
6. **Sale → Delivery Handover**
7. **Program & Training Operations**
8. **Entitlement & Membership Management**
9. **Customer Success & Support**
10. **Retention – Upsell – Cross-sell – Referral**
11. **OmniChannel & Customer Interaction**
12. **Task – Workflow – Dashboard – Automation – Governance**

Toàn bộ dùng chung:

- Customer ID.
- User/Role.
- Task Engine.
- Audit.
- Notification.
- Permission.
- File/Attachment.
- Event Layer.
- A.I Tool Layer.

---

# 8. MODULE 1 — CUSTOMER 360 & MASTER DATA

## 8.1. Mục tiêu

Tạo một hồ sơ thống nhất cho mỗi khách hàng/cá nhân/doanh nghiệp.

## 8.2. Customer 360

### Thông tin cá nhân

- Họ tên.
- SĐT.
- Email.
- Ngày sinh.
- Giới tính nếu cần.
- Địa chỉ.
- Chức danh.
- Công ty.
- Ngành nghề.

### Quan hệ với ABM

- First Source.
- Latest Source.
- Current Owner.
- Previous Owner.
- Team.
- Tags.
- Segment.
- Customer Status.

### Lịch sử thương mại

- Lead.
- Deal.
- Product Interested.
- Proposal.
- Contract.
- Order.
- Payment Reference.
- Receivable Reference.

### Lịch sử đào tạo/triển khai

- Program.
- Course.
- Session.
- Attendance.
- Account.
- Entitlement.
- Coaching.
- Membership.

### Lịch sử tương tác

- Call.
- Email.
- Zalo.
- Facebook.
- Meeting.
- Note.
- Message.
- Ticket.
- Survey.
- Complaint.

### Cơ hội tiếp theo

- Renewal.
- Upsell.
- Cross-sell.
- Referral.

---

# 9. MODULE 2 — LEAD INTAKE, DISTRIBUTION & GOVERNANCE

## 9.1. Nguồn Lead

- Facebook.
- Zalo.
- Website.
- Landing Page.
- Form.
- Email.
- Event.
- Webinar.
- Offline.
- Partner.
- Referral.
- Sale Self-Sourced.
- Import.
- API.

## 9.2. Duplicate Check

Kiểm tra theo:

- Phone.
- Email.
- Facebook Identity.
- Zalo Identity.
- Company.
- Custom Rules.

Không tự động xóa record nghi trùng.

## 9.3. Lead Distribution

Kiến trúc hướng tới hỗ trợ:

- Manual.
- Round Robin.
- Weighted Round Robin.
- Load Based.
- Source Based.
- Product Based.
- Skill Based.
- Territory Based.
- AI Matching ở giai đoạn sau.

MVP chỉ triển khai phương thức thực sự cần.

## 9.4. Lead Ownership

Mỗi Lead cần:

- Primary Owner.
- Team.
- Assigned At.
- Assigned By.
- Support User nếu cần.
- Assignment History.

## 9.5. SLA

Có thể cấu hình bằng config:

- Accept Lead Time.
- First Response SLA.
- Follow-up SLA.
- Inactive Days.
- Stage Age.
- Reassign Threshold.

---

# 10. MODULE 3 — SALES PIPELINE, ACTIVITY & FOLLOW-UP

## 10.1. Pipeline

Kiến trúc đích hỗ trợ:

- B2C.
- B2B/Inhouse.
- A.I Implementation.
- Partnership.
- Renewal.

MVP chỉ chọn **một Pipeline**.

## 10.2. Pipeline mẫu

**Lead mới → Đã liên hệ → Tiềm năng → Tư vấn → Báo giá → Đàm phán → Chờ chốt → Won / Lost**

## 10.3. Stage Definition

Mỗi Stage có:

- Entry Criteria.
- Required Fields.
- Required Activity.
- Exit Criteria.
- SLA.
- Auto Task.
- Notification.
- Approval nếu cần.

## 10.4. Forced Next Action

Mọi Lead/Deal active bắt buộc có:

**Owner + Next Action + Deadline**

## 10.5. Activity Timeline

- Call.
- Meeting.
- Email.
- Note.
- Message.
- File Sent.
- Proposal Sent.
- Stage Changed.
- Owner Changed.
- Task Completed.
- Customer Reply.

## 10.6. Lost Reason

Lost phải có reason.

Ví dụ:

- Giá.
- Không đúng nhu cầu.
- Không đúng thời điểm.
- Không đủ ngân sách.
- Đối thủ.
- Không tiếp cận đúng Decision Maker.
- Không Follow-up kịp.
- Không phản hồi.
- Khác.

---

# 11. MODULE 4 — PRODUCT, PRICING & SALES KNOWLEDGE

## 11.1. Product Master

- Product Code.
- Name.
- Family.
- Segment.
- Problem Solved.
- Outcome.
- Delivery Model.
- Timeline.
- Standard Price.
- Price Policy.
- Entitlement Template.
- Sales Content.
- Status.

## 11.2. Product Type

- Course.
- Service.
- Membership.
- Digital Product.
- Bundle.
- Physical Product nếu cần.

## 11.3. Pricing

Kiến trúc đích hỗ trợ:

- Standard Price.
- Customer Group Price.
- Promotion.
- Bundle.
- Coupon nếu cần.
- Discount Approval.

MVP chỉ làm chính sách thực sự dùng.

## 11.4. Sales Knowledge Hub

Quản lý:

- Product Sheet.
- Price.
- Brochure.
- Proposal Template.
- Profile.
- Instructor Profile.
- FAQ.
- Case Study.
- Feedback.
- Demo.
- Sales Script.
- Objection Handling.
- Contract Template.
- Landing Page.

Metadata:

- Version.
- Owner.
- Effective Date.
- Status.
- Archived At.

Chỉ tài liệu **Approved** được dùng cho tư vấn chính thức/A.I.

---

# 12. MODULE 5 — PROPOSAL, CONTRACT, ORDER & PAYMENT REFERENCE

## 12.1. Proposal

- Select Product.
- Select Package.
- Add Deliverable.
- Adjust allowed discount.
- Generate from Template.
- Version.
- Approval.
- Status.

## 12.2. Discount Approval

Nếu vượt quyền:

**Request → Approval → Approved/Rejected → mới được gửi**

## 12.3. Contract

Status:

- Draft.
- Sent.
- Negotiating.
- Signed.
- Cancelled.

Fields:

- Contract Number.
- File.
- Version.
- Value.
- Signed Date.
- Special Terms.
- Approval.

## 12.4. Order

- Customer.
- Product.
- Quantity.
- Price.
- Discount.
- Net Value.
- Related Deal.
- Related Contract.
- Status.

## 12.5. Payment Reference

- Total Due.
- Payment Schedule.
- Due Date.
- Confirmed Amount.
- Confirmed Date.
- Outstanding.
- Reconciliation Status.

**Lưu ý:** giai đoạn đầu, dữ liệu “thực thu chính thức” do hệ thống tài chính/kế toán xác nhận.

---

# 13. MODULE 6 — SALE → DELIVERY HANDOVER

## 13.1. Mục tiêu

Không để thông tin cam kết với khách hàng bị mất giữa Sale và Tổ chức/Triển khai.

## 13.2. Trigger

- Deal Won.
- Hoặc Payment đạt điều kiện kích hoạt.
- Hoặc Leader chủ động tạo.

## 13.3. Handover Case

- Customer.
- Contact chính.
- Product.
- Deal.
- Contract.
- Payment Status.
- What Was Sold.
- Deliverables.
- Commitments.
- Entitlements.
- Number of Learners.
- Date/Timeline.
- Location.
- Special Requests.
- Sale Owner.
- Delivery Owner.
- Notes.

## 13.4. Handover Gate

Không Complete nếu thiếu Mandatory Fields.

## 13.5. Change Control

Sau khi Handover Complete, thay đổi phải có:

- Change Request.
- Old Value.
- New Value.
- Requester.
- Approver nếu cần.
- Timestamp.
- Reason.

---

# 14. MODULE 7 — PROGRAM & TRAINING OPERATIONS

## 14.1. Program Types

- Online.
- Offline.
- Bootcamp.
- Coaching.
- Inhouse.
- Event.
- Webinar.
- Dã ngoại.
- Khác.

## 14.2. Program Profile

- Name.
- Product.
- Customer.
- Start/End.
- Location.
- Zoom/Meet.
- Instructor.
- Sale.
- Organizer.
- Technical.
- Media.
- Support.
- Learners.
- Materials.
- Checklist.
- Entitlements.
- Notes.

## 14.3. Resource Conflict

Cảnh báo:

- Instructor Conflict.
- Zoom Conflict.
- Room Conflict.
- Location Conflict.
- Technical Conflict.
- Media Conflict.
- Support Resource Conflict.

## 14.4. Checklist Template

### Before

- Learner List.
- Group.
- Announcement.
- Instructor.
- Content.
- Materials.
- Zoom.
- Location.
- Technical Test.
- Media.
- Check-in.
- Logistics.

### During

- Attendance.
- Moderation.
- Technical.
- Record.
- Support.
- Media.
- Incident Handling.

### After

- Materials.
- Record.
- Survey.
- Certificate.
- Entitlements.
- CSKH Handover.
- Post-event Issues.
- Closure.

## 14.5. Program Closure

Chỉ Close nếu:

- Mandatory Tasks complete.
- Required documents uploaded.
- Required entitlements processed.
- Critical issues resolved/transferred.

---

# 15. MODULE 8 — ENTITLEMENT & MEMBERSHIP MANAGEMENT

## 15.1. Khái niệm

Entitlement là mọi thứ khách hàng có quyền nhận sau khi mua.

Ví dụ:

- Course.
- Video.
- Membership.
- Coaching.
- Mastermind.
- Support.
- Event Ticket.
- Template.
- Document.
- Account.
- Consulting.
- Implementation Service.

## 15.2. Entitlement Fields

- Customer.
- Product.
- Type.
- Quantity.
- Start Date.
- Due Date.
- Expiry Date.
- Owner.
- Status.
- Fulfillment Evidence.
- Notes.

## 15.3. Status

- Pending.
- Activated.
- Partially Fulfilled.
- Fulfilled.
- Expired.
- Cancelled.

## 15.4. Alerts

- Upcoming Due.
- Overdue.
- Expiring.
- Unused.

Nguyên tắc:

**Sale bán đúng → Công ty cung cấp đúng → Khách nhận đủ → Có bằng chứng.**

---

# 16. MODULE 9 — CUSTOMER SUCCESS & SUPPORT

## 16.1. Customer Success View

Theo dõi:

- Active Products.
- Active Programs.
- Entitlements.
- Tickets.
- Complaints.
- Feedback.
- Satisfaction.
- Last Contact.
- Next Contact.
- Renewal Opportunity.

## 16.2. Ticket

Ticket cần có:

- Category.
- Priority.
- Owner.
- SLA.
- Status.
- Resolution.
- Customer Communication.
- Related Product/Program.

## 16.3. Health Signals

Không chỉ dùng một Health Score tổng hợp.

Phải hiển thị nguyên nhân cụ thể.

Signal có thể gồm:

- Long Inactivity.
- Absence.
- Unused Entitlement.
- Overdue Ticket.
- Negative Feedback.
- Expiring Membership.
- Multiple Unresolved Issues.
- Payment Issue nếu phù hợp.

---

# 17. MODULE 10 — RETENTION, UPSELL, CROSS-SELL & REFERRAL

Khách cũ là một Pipeline doanh thu riêng.

## 17.1. Opportunity Types

- Repeat Purchase.
- Renewal.
- Upsell.
- Cross-sell.
- Referral.

## 17.2. Trigger

Có thể tạo Opportunity từ:

- Product Completed.
- Membership Expiring.
- Customer Success Signal.
- New Product Match.
- Campaign.
- Manual.

## 17.3. Next Best Product

A.I có thể gợi ý dựa trên:

- Product History.
- Role.
- Industry.
- Need.
- Engagement.
- Customer Segment.

Con người quyết định việc tiếp cận.

---

# 18. MODULE 11 — OMNICHANNEL & CUSTOMER INTERACTION

## 18.1. Kênh định hướng

- Facebook Messenger.
- Facebook Comments.
- Zalo OA.
- Email.
- Website Livechat.
- Instagram.
- TikTok khi khả thi.
- SMS khi cần.

## 18.2. Unified Inbox

Một Inbox, nhưng dữ liệu cuối cùng phải quay về:

**Customer Timeline**

## 18.3. Conversation Context

Khi Sale/CSKH mở hội thoại cần thấy:

- Customer.
- Owner.
- Open Deal.
- Product Interest.
- Last Activity.
- Next Action.
- Entitlement/Ticket nếu liên quan.

## 18.4. Channel Routing

- Manual.
- Round Robin.
- Load Based.
- Source Rule.
- Keyword Rule.
- Working Hour Rule.

---

# 19. MODULE 12 — TASK, WORKFLOW, DASHBOARD, AUTOMATION & GOVERNANCE

## 19.1. Task Types

### CRM Task

Liên quan Customer/Lead/Deal.

### Delivery Task

Liên quan Handover/Program/Entitlement.

### Internal Task

Công việc nội bộ.

Dùng cùng một Task Engine.

## 19.2. Task Engine

- Title.
- Description.
- Owner.
- Collaborator.
- Priority.
- Due Date.
- Status.
- Subtask.
- Dependency.
- Attachment.
- Comment.
- Context Object.
- Audit.

Views:

- My Tasks.
- List.
- Kanban.
- Calendar.
- Timeline/Gantt ở giai đoạn sau.

## 19.3. Workflow Engine

Ngay từ đầu cần có Event/Handler rõ.

Không cần UI Builder ở MVP.

Mẫu:

**Trigger → Condition → Action → Wait → Check → Approval → Next Action**

Event định hướng:

- LeadCreated.
- LeadAssigned.
- StageChanged.
- DealWon.
- PaymentConfirmed.
- HandoverCreated.
- ProgramScheduled.
- EntitlementDue.
- TicketOverdue.

---

# 20. A.I COPILOT, A.I AGENT VÀ MCP

## 20.1. Sales Copilot

- Tóm tắt Customer.
- Tóm tắt Conversation.
- Gợi ý câu hỏi khai thác.
- Gợi ý Next Action.
- Draft Follow-up.
- Gợi ý tài liệu Approved.
- Draft Proposal.

## 20.2. CSKH Copilot

- Tóm tắt hành trình khách.
- Tóm tắt Ticket.
- Gợi ý phản hồi.
- Phát hiện quyền lợi thiếu.
- Gợi ý chăm sóc lại.

## 20.3. Program Copilot

- Program Readiness Summary.
- Missing Tasks.
- Resource Conflict.
- Overdue Items.
- Post-program Summary.

## 20.4. Executive Copilot

Có thể hỏi:

- Deal nào đang có rủi ro?
- Sale nào có nhiều Follow-up quá hạn?
- Chương trình nào chưa sẵn sàng?
- Quyền lợi nào quá hạn?
- Khách VIP nào lâu chưa chăm sóc?
- Doanh thu dự kiến sắp tới đến từ đâu?

## 20.5. A.I Agents

Định hướng:

- Lead Qualification Agent.
- Lead Routing Agent.
- Follow-up Agent.
- Deal Risk Agent.
- Handover Agent.
- Entitlement Agent.
- Program Operations Agent.
- Customer Success Agent.
- Executive Brief Agent.

## 20.6. Nguyên tắc A.I

A.I chỉ tự động hành động khi:

- Scope rõ.
- Input đủ.
- Permission cho phép.
- Có Audit.
- Có Error Handling.
- Có Approval nếu cần.

A.I không được:

- Tự bịa giá.
- Tự bịa chính sách.
- Tự bịa quyền lợi.
- Tự cam kết với khách vượt dữ liệu được phê duyệt.
- Bypass Role/Permission.

## 20.7. MCP

### Customer

- `search_customer`
- `get_customer_360`
- `get_customer_timeline`

### CRM

- `create_lead`
- `update_lead`
- `update_stage`
- `add_activity`
- `create_next_action`

### Sales

- `get_products`
- `get_price`
- `create_proposal`
- `create_order`

### Program

- `get_program`
- `get_program_readiness`
- `create_program_task`

### Entitlement

- `get_entitlements`
- `update_entitlement_status`

### Analytics

- `get_sales_summary`
- `get_pipeline`
- `get_overdue_followups`
- `get_program_risks`

MCP cần:

- API Key.
- Tool Scope.
- User/System Context.
- Audit.
- Rate Limit.
- Sandbox Mode.
- Permission mapping.

Write Tools phải phân quyền chặt hơn Read Tools.

---

# 21. DATA MODEL LÕI

## 21.1. Organization

- Company
- Branch
- Department
- Team
- User
- Role
- Permission

## 21.2. Customer

- Contact
- Company
- CustomerIdentity
- Address
- Tag
- Segment

## 21.3. CRM

- Lead
- Deal
- Pipeline
- Stage
- Assignment
- Activity
- NextAction
- CRMTask

## 21.4. Commercial

- Product
- ProductPackage
- PricePolicy
- Promotion
- Proposal
- Contract
- Order
- PaymentSchedule
- PaymentReference

## 21.5. Delivery

- Handover
- Program
- Session
- Enrollment
- Resource
- ProgramTask

## 21.6. Customer Success

- Entitlement
- Membership
- SupportTicket
- Feedback
- Survey
- NPS
- RenewalOpportunity

## 21.7. Communication

- Channel
- Conversation
- Message
- Attachment

## 21.8. Governance

- Approval
- Notification
- AutomationRule
- AuditLog
- IntegrationLog

---

# 22. SYSTEM OF RECORD

Hệ thống phải có ma trận rõ.

| Loại dữ liệu | Nguồn sự thật giai đoạn đầu | Đích tương lai |
|---|---|---|
| Customer | ABM CRM | ABM CRM |
| Lead/Deal/Pipeline | ABM CRM | ABM CRM |
| Activity/Follow-up | ABM CRM | ABM CRM |
| Product Master | Nguồn chuẩn được chốt/CRM | ABM CRM |
| Sales Knowledge | Drive/Knowledge Hub | Tích hợp với CRM |
| Proposal | ABM CRM | ABM CRM |
| Contract File | CRM + kho file chuẩn | CRM + kho file |
| Payment Schedule | ABM CRM | ABM CRM |
| Actual Cash Collected | Hệ thống tài chính/kế toán | Tùy quyết định sau |
| Handover | ABM CRM | ABM CRM |
| Entitlement | ABM CRM | ABM CRM |
| Program Ops | Notion/CRM tùy giai đoạn | ABM CRM |
| Official Documents | Google Drive | Google Drive/Knowledge Layer |
| Internal Chat | Công cụ hiện hành | Không bắt buộc thay |

Nguyên tắc:

> **Một loại dữ liệu chỉ có một Write Master.**

---

# 23. PHÂN QUYỀN VÀ BẢO MẬT

## 23.1. RBAC + Data Scope

### Sale

- Read Own/Assigned.
- Edit Own/Assigned.
- Không xem Data ngoài Scope.
- Không Export toàn bộ.

### Leader

- Team Scope.

### Department Head

- Department Scope.

### BGĐ

- Organization Scope.

### Admin

- System Config.

## 23.2. Critical Permission

Tách riêng:

- Merge Customer.
- Delete/Archive.
- Export.
- Discount Approval.
- Payment Confirmation.
- Contract Approval.
- Entitlement Override.
- Role Management.
- A.I Write Tool.

## 23.3. Không tin UI

Permission phải kiểm tra ở Backend/Policy Layer.

Không dựa vào việc “ẩn nút”.

---

# 24. AUDIT, BACKUP, RESTORE VÀ VẬN HÀNH

## 24.1. Audit

Audit phải trả lời:

**Ai → làm gì → record nào → lúc nào → giá trị cũ → giá trị mới**

Bắt buộc với:

- Owner Change.
- Stage Change.
- Merge.
- Discount.
- Contract.
- Payment Reference.
- Entitlement.
- Permission.
- A.I Action.
- Data Export.

## 24.2. Backup

- Database Backup.
- File Backup.
- Config Backup.
- Encryption Key handling nếu áp dụng.

## 24.3. Restore

Không chỉ backup.

Phải có:

- Restore Procedure.
- Test Restore.
- Recovery Checklist.
- Recovery Owner.

---

# 25. PRIVACY BY DESIGN

Thiết kế từ đầu:

- Data Classification.
- Purpose.
- Data Minimization.
- Consent khi áp dụng.
- Access Control.
- Retention.
- Correction.
- Export.
- Deletion/Anonymization Request.
- Encryption.
- Audit.
- Incident Handling.

Không lưu dữ liệu chỉ vì “có thể hữu ích sau này”.

Phải biết:

- Dữ liệu nào cần.
- Vì sao cần.
- Ai được xem.
- Bao lâu giữ.

---

# 26. TÍCH HỢP

Kiến trúc chuẩn bị cho:

- Facebook.
- Zalo OA.
- Email.
- Website.
- Landing Page.
- Form.
- Google Drive.
- Calendar.
- Zoom/Meet.
- LMS.
- Payment Gateway.
- Accounting.
- API.
- Webhook.
- MCP.

Tích hợp phải có:

- Authentication.
- Retry.
- Queue.
- Error Log.
- Idempotency khi cần.
- Integration Audit.

---

# 27. MOBILE VÀ TRẢI NGHIỆM NGƯỜI DÙNG

## 27.1. MVP

Responsive Web/PWA.

## 27.2. Sale/CSKH cần làm được trên điện thoại

- Search Customer.
- View Customer.
- Call.
- Add Note.
- View Task.
- Complete Task.
- Update Stage.
- Set Next Action.
- View Calendar.
- Receive Notification.

Không ưu tiên Native App ở giai đoạn đầu.

---

# 28. VIBE CODING ENGINEERING GUARDRAILS

Đây là phần bắt buộc của dự án và đồng thời là tài sản đào tạo.

## 28.1. Guardrail 1 — Data Model Lock

Không để A.I tự tiện đổi schema.

Mọi thay đổi:

- Có lý do.
- Có review.
- Có migration.
- Có test.
- Có rollback plan.

## 28.2. Guardrail 2 — Migration Discipline

Không sửa Database Production bằng tay.

## 28.3. Guardrail 3 — Auth/RBAC Tests

Có test cho:

- Sale không xem khách người khác.
- Leader xem đúng Team.
- Admin đúng quyền.
- Endpoint không bị bypass.

## 28.4. Guardrail 4 — Critical Flow Tests

Bắt buộc test:

- Create Customer.
- Duplicate Check.
- Assign Lead.
- Change Owner.
- Change Stage.
- Lost Deal.
- Payment Confirmation Reference.
- Handover.
- Entitlement.
- Permission.

## 28.5. Guardrail 5 — Backup & Restore

Test phục hồi thật.

## 28.6. Guardrail 6 — Auditability

Mọi hành động quan trọng truy vết được.

## 28.7. Guardrail 7 — Documentation as Product

Bắt buộc có:

- README.
- Architecture.
- ERD.
- ADR.
- Deployment Guide.
- Backup/Restore SOP.
- Config Guide.
- Permission Matrix.
- Workflow Documentation.
- Release Notes.

## 28.8. Guardrail 8 — Production Safety

- Staging.
- Environment Separation.
- Secret Management.
- Deployment Checklist.
- Rollback.
- Error Monitoring.

---

# 29. KIẾN TRÚC KỸ THUẬT ĐỊNH HƯỚNG

Kiến trúc kỹ thuật cuối cùng phải được chốt bằng ADR riêng.

## 29.1. Nguyên tắc

- Relational Database.
- Mature Auth.
- Mature Authorization.
- Migration tốt.
- Test tốt.
- Framework phổ biến.
- A.I code tốt.
- Dễ deploy.
- Dễ backup.
- Không lock-in.
- Dễ dạy.
- Dễ chuyển giao.

## 29.2. Kiến trúc ứng viên

Có thể tiếp tục đánh giá hướng:

- Backend: Laravel/PHP.
- Frontend: React + Inertia hoặc lựa chọn tương đương.
- Database: MariaDB/PostgreSQL.
- Redis.
- Queue.
- Realtime.
- Docker.
- Nginx.
- Object/File Storage theo nhu cầu.
- MCP Layer.
- A.I SDK/Provider Abstraction.

Không coi stack này là bất biến trước khi ADR được phê duyệt.

## 29.3. Kiến trúc ứng dụng

Ưu tiên:

> **Modular Monolith**

Lý do:

- Đội nhỏ.
- Dễ code.
- Dễ debug.
- Dễ deploy.
- Ít overhead hơn Microservices.
- Vẫn chia Domain rõ.
- Phù hợp vibe coding có kiểm soát.

---

# 30. NGUYÊN TẮC CONFIG-LITE

Không xây “Admin có thể chỉnh mọi thứ”.

Nhưng tách rõ phần có thể thay:

- Branding.
- Roles.
- Permissions.
- Pipeline.
- Stages.
- Lost Reasons.
- Product Types.
- Entitlement Types.
- Notification Thresholds.
- SLA.
- Seed Data.

Không cần UI Builder ban đầu.

Config có thể nằm trong:

- Database Seed.
- Config Files.
- Admin Form đơn giản.

Mục tiêu:

> **Không SaaS hóa, nhưng đủ sạch để tái triển khai.**

---

# 31. DEFINITION OF DONE TỔNG THỂ

Hệ thống đích chỉ được coi là hoàn chỉnh khi một hành trình có thể chạy xuyên suốt mà không cần copy sang Sheet trung gian:

**Lead → Assignment → Qualification → Follow-up → Proposal → Won → Contract → Payment Reference → Handover → Program/Delivery → Entitlement → CSKH → Renewal/Upsell**

Nếu còn phải copy thủ công giữa các hệ thống trong phạm vi đã tuyên bố hoàn thành, Workflow chưa thực sự khép kín.

---

# 32. KPI ĐÁNH GIÁ HỆ THỐNG

Không đặt Target % khi chưa có Baseline.

## 32.1. Data Quality

- Duplicate Rate.
- Record Completeness.
- Customer without Owner.
- Customer without Next Action.

## 32.2. Sale

- First Response SLA.
- Follow-up Compliance.
- Lead → Opportunity.
- Opportunity → Won.
- Average Sales Cycle.
- Lost Reason Completeness.
- Stale Deal Rate.
- Pipeline Coverage.

## 32.3. Delivery

- Handover Completeness.
- Program Readiness.
- Overdue Tasks.
- Resource Conflict.
- Program Closure Compliance.

## 32.4. Customer Success

- Entitlement Overdue.
- Ticket SLA.
- Satisfaction.
- Repeat Purchase.
- Renewal.
- Referral.

## 32.5. Adoption

- Daily Active Users.
- Weekly Active Users.
- % nghiệp vụ chạy trong hệ thống.
- % khách active có Next Action.
- % scope không còn cần Sheet/Zalo.

## 32.6. Engineering

- Critical Bug Rate.
- Restore Test Pass.
- RBAC Test Pass.
- Deployment Failure Rate.
- Mean Time to Recovery.

---

# 33. LỘ TRÌNH MVP THEO CAPABILITY LADDER

Không chia roadmap theo việc “làm hết module 1 rồi module 2”.

Mỗi bậc phải:

1. Chạy được thật.
2. Có người dùng thật.
3. Có Data thật.
4. Có Exit Gate.
5. Tạo ra một case study đào tạo.
6. Có tài liệu chuyển giao.

Các bậc:

**MVP 0 — Foundation**  
**MVP 1 — CRM Core Vertical Slice**  
**MVP 2 — Revenue → Handover → Entitlement**  
**MVP 3 — Program Operations & Customer Success**  
**MVP 4 — OmniChannel & Automation**  
**MVP 5 — A.I & Digital Workforce**

---

# 34. MVP 0 — FOUNDATION

## 34.1. Mục tiêu

Khóa tư duy và Data Model trước khi code sâu.

Đây là giai đoạn “Brain First”.

## 34.2. Deliverables Business

- Chọn 01 Pipeline MVP.
- Stage Definition.
- Lost Reason.
- Lead Ownership Policy.
- Data Distribution Policy.
- Customer Data Model.
- Product Master mẫu.
- Handover Schema.
- Entitlement Model.
- Role/Permission Matrix.
- System of Record Matrix.
- Danh mục nguồn Lead.
- Quy tắc Duplicate.
- Quy tắc chuyển/nhả Lead.
- Quy tắc Next Action.

## 34.3. Deliverables Technical

- Architecture ADR.
- ERD v1.
- Repository Structure.
- Coding Convention.
- Environments.
- Migration Convention.
- Audit Convention.
- Backup/Restore Plan.
- Test Strategy.
- Seed/Config Structure.
- Deployment Baseline.
- Security Baseline.

## 34.4. Deliverables Training

- Case “Brain First trước khi Vibe Code”.
- Template PRD.
- Template ERD.
- Checklist khóa Data Model.
- Checklist Role/Permission.
- Checklist System of Record.
- Bài học “Không để A.I tự quyết schema”.

## 34.5. Không được làm ở MVP 0

- Không lao vào làm 12 module.
- Không xây A.I Agent.
- Không làm Workflow Builder.
- Không migrate toàn bộ Data.
- Không tối ưu UI quá sớm.
- Không chốt SaaS/Multi-tenant.

## 34.6. Exit Gate MVP 0

Phải trả lời rõ:

- Object trung tâm là gì?
- Customer – Contact – Company – Lead – Deal quan hệ ra sao?
- Pipeline MVP là pipeline nào?
- Sale được xem dữ liệu nào?
- Lead được giao/chuyển/nhả ra sao?
- Dữ liệu nào là nguồn sự thật?
- Handover bắt buộc những gì?
- Entitlement được sinh thế nào?
- Payment thực thu lấy từ đâu?
- Stack/Architecture đã có ADR chưa?

Chỉ khi các câu trên có câu trả lời đủ rõ mới chuyển sang MVP 1.

---

# 35. MVP 1 — CRM CORE VERTICAL SLICE

## 35.1. Mục tiêu

Một Lead thật chạy xuyên quy trình Sale cơ bản mà không cần Sheet trung gian.

Đây là **MVP thật đầu tiên**.

## 35.2. Scope

- User/Auth.
- RBAC.
- Team.
- Customer 360 cơ bản.
- Global Search cơ bản.
- Duplicate Check.
- Lead.
- Lead Assignment.
- 01 Pipeline.
- Stage.
- Activity.
- Forced Next Action.
- Follow-up.
- Lost Reason.
- Audit.
- Sale Dashboard.
- Leader Dashboard cơ bản.
- Notification cơ bản.
- Responsive Mobile/PWA.

## 35.3. Flow phải chạy được

**Lead vào  
→ Check Duplicate  
→ Assign Sale  
→ First Contact  
→ Activity  
→ Next Action  
→ Stage Change  
→ Follow-up  
→ Won/Lost  
→ Audit**

## 35.4. Dashboard Sale MVP

- My Leads.
- My Deals.
- Tasks Today.
- Follow-up Overdue.
- Pipeline.
- Won/Lost.
- Next Action.

## 35.5. Dashboard Leader MVP

- Lead by Sale.
- Pipeline by Sale.
- Overdue Follow-up.
- Stale Leads.
- Won/Lost.
- Deal cần hỗ trợ.

## 35.6. Chưa cần

- Multi Pipeline.
- Full Product Catalog.
- Contract.
- Full Payment.
- Program Ops.
- OmniChannel đầy đủ.
- A.I Agent.
- Advanced Analytics.

## 35.7. Acceptance Criteria chính

### Customer

- Tìm được theo tên/SĐT/email.
- Không tạo trùng dễ dàng khi SĐT/email đã tồn tại.
- Có Timeline cơ bản.

### Lead

- Có Owner.
- Có Stage.
- Có Next Action.
- Có Deadline.

### Pipeline

- Có Stage rõ.
- Lost bắt buộc Lost Reason.
- Stage change được Audit.

### Permission

- Sale không xem ngoài Scope.
- Leader xem đúng Team.
- Backend kiểm Permission.

### Follow-up

- Overdue hiển thị rõ.
- Người dùng nhìn được việc hôm nay.

## 35.8. Exit Gate MVP 1

Chỉ qua MVP 2 khi:

- Người dùng thật dùng hằng ngày trong phạm vi MVP.
- Không có Critical Security Bug.
- RBAC Test Pass.
- Backup/Restore Test Pass.
- Không mất Data.
- Lead active không thiếu Owner/Next Action ngoài ngoại lệ có chủ đích.
- Leader nhìn được Overdue.
- Không cần Sheet song song cho Pipeline MVP.
- Có ít nhất một vòng Kaizen từ phản hồi thực tế.
- Documentation cập nhật.
- Release/rollback procedure đã thử.

## 35.9. Case đào tạo

> **“Vibe coding một CRM lõi nhưng không phá dữ liệu và phân quyền.”**

Nội dung có thể dạy:

- Từ nghiệp vụ sang Data Model.
- CRUD không đủ.
- RBAC.
- Next Action.
- Audit.
- Testing.
- Backup/Restore.

---

# 36. MVP 2 — REVENUE → HANDOVER → ENTITLEMENT

## 36.1. Mục tiêu

Nối Sale tới quá trình sau chốt, tránh “Deal Won là hết việc”.

## 36.2. Scope

- Product Master v1.
- Price/Policy cơ bản.
- Proposal.
- Discount Approval.
- Contract Reference.
- Order.
- Payment Schedule.
- Payment Confirmation Reference.
- Handover Case.
- Handover Gate.
- Change Log.
- Entitlement.
- Entitlement Alert.

## 36.3. Flow

**Deal Won  
→ Product/Proposal  
→ Contract Reference  
→ Payment Reference  
→ Handover  
→ Entitlement Created  
→ Owner Assigned**

## 36.4. Product MVP

Chỉ cần các loại sản phẩm ABM đang dùng.

Không cần làm mọi loại Product Type tương lai.

## 36.5. Payment Principle

CRM chưa là sổ cái kế toán.

Confirmed Payment phải:

- Có Source.
- Có người xác nhận hoặc tích hợp xác nhận.
- Có Audit.
- Không cho Sale tùy ý sửa nếu không có quyền.

## 36.6. Handover Gate

Mandatory Fields ví dụ:

- Customer.
- Contact chính.
- Product.
- Nội dung đã bán.
- Cam kết.
- Quyền lợi.
- Timeline.
- Payment Status.
- Delivery Owner.

## 36.7. Entitlement Generation

Khi Product/Order đủ điều kiện:

- Sinh quyền lợi theo template.
- Gán Owner.
- Gán Due/Expiry.
- Không sinh trùng.

## 36.8. Exit Gate MVP 2

- Handover không còn phụ thuộc tin nhắn rời rạc trong scope đã triển khai.
- Mandatory Fields hoạt động.
- Entitlement sinh đúng.
- Không tạo quyền lợi sai khi Deal/Order thay đổi.
- Approval hoạt động.
- Payment Reference có nguồn xác nhận rõ.
- Audit đầy đủ.
- Restore Pass.
- Người dùng thật xác nhận quy trình tốt hơn cách cũ.
- Không mất cam kết sau bàn giao.

## 36.9. Case đào tạo

> **“Từ CRUD sang Workflow có phê duyệt và tính toàn vẹn dữ liệu.”**

Nội dung:

- Approval.
- Transaction.
- Change Log.
- Gate.
- Entitlement.
- Data integrity.
- Boundary giữa CRM và kế toán.

---

# 37. MVP 3 — PROGRAM OPERATIONS & CUSTOMER SUCCESS

## 37.1. Mục tiêu

Nối Handover tới vận hành chương trình và chăm sóc sau bán.

## 37.2. Scope

- Program.
- Session.
- Learner List.
- Resource.
- Checklist Template.
- Program Task.
- Resource Conflict.
- Program Readiness.
- Program Closure.
- Ticket.
- CSKH View.
- Membership.
- Entitlement Fulfillment.
- Renewal/Upsell Opportunity cơ bản.

## 37.3. Flow

**Handover  
→ Program  
→ Checklist  
→ Resource Check  
→ Delivery  
→ Entitlement Fulfillment  
→ CSKH  
→ Renewal/Upsell**

## 37.4. Program Readiness

Hệ thống phải trả lời:

- Chương trình nào sắp diễn ra?
- Đã sẵn sàng chưa?
- Việc gì chưa xong?
- Ai chịu trách nhiệm?
- Việc nào quá hạn?
- Có trùng giảng viên/Zoom/địa điểm/nhân sự không?
- Tài liệu/Record/quyền lợi nào còn thiếu?

## 37.5. Customer Success MVP

- Last Contact.
- Next Contact.
- Ticket.
- Ticket Owner.
- Ticket SLA.
- Entitlement Status.
- Membership Expiry.
- Renewal Opportunity.

## 37.6. Exit Gate MVP 3

- Một chương trình thật vận hành end-to-end.
- Không cần Sheet riêng cho Checklist trong scope đã chuyển.
- Resource Conflict có cảnh báo.
- Program Closure Gate hoạt động.
- Entitlement không bị bỏ sót.
- Ticket có Owner + SLA.
- CSKH có Last/Next Contact.
- Có vòng Kaizen.
- Không có Critical Program Data Loss.

## 37.7. Case đào tạo

> **“Vibe coding nghiệp vụ đặc thù: lịch, checklist, conflict, entitlement.”**

---

# 38. MVP 4 — OMNICHANNEL & AUTOMATION

## 38.1. Mục tiêu

Giảm thao tác tay và gom các điểm chạm khách hàng về hồ sơ chung.

## 38.2. Scope ưu tiên

Chọn theo nhu cầu thật:

- Facebook.
- Zalo OA.
- Email.
- Website Form.
- Unified Inbox.
- Conversation → Customer Link.
- Notification.
- Escalation.
- Event-driven Workflow.
- Automation Rule bằng config.
- Dashboard nâng cao.

## 38.3. Workflow tiêu biểu

### Lead Created

**Check Duplicate  
→ Assign Team  
→ Assign Sale  
→ Create Task  
→ Start SLA**

### Payment Confirmed

**Update Reference  
→ Create Handover  
→ Create Entitlement  
→ Notify Delivery**

### Program T-N

**Check Checklist  
→ Check Resources  
→ Alert Missing**

### Entitlement Overdue

**Alert Owner  
→ Alert Manager  
→ Escalate**

## 38.4. Full Workflow Builder

Chưa cần UI kéo-thả hoàn chỉnh.

Workflow có thể cấu hình qua:

- Config.
- Seed.
- Admin form đơn giản.
- Code Handler chuẩn hóa.

## 38.5. Integration Guardrails

- Retry.
- Error Log.
- Dead Letter/Failure handling nếu cần.
- Idempotency với sự kiện quan trọng.
- Duplicate Protection.
- Integration Audit.

## 38.6. Exit Gate MVP 4

- Integration có Retry/Error Log.
- Không tạo Duplicate mất kiểm soát.
- Critical automation có test.
- Notification không spam.
- Fail Integration không làm mất Data.
- Conversation gắn đúng Customer trong phạm vi hỗ trợ.
- Workflow lỗi có khả năng xử lý lại.

## 38.7. Case đào tạo

> **“Tự động hóa thật: Event → Workflow → Retry → Audit.”**

---

# 39. MVP 5 — A.I & DIGITAL WORKFORCE

## 39.1. Mục tiêu

Đưa A.I lên trên nền Data + Workflow đã ổn định.

## 39.2. Copilot trước Agent

Thứ tự trưởng thành:

1. Read.
2. Summarize.
3. Recommend.
4. Draft.
5. Execute Low-risk.
6. Execute High-risk with Approval.

## 39.3. Scope

- Sales Copilot.
- CSKH Copilot.
- Program Copilot.
- Executive Copilot.
- MCP Read Tools.
- MCP Write Tools có Scope.
- Follow-up Agent.
- Handover Agent.
- Entitlement Agent.
- Program Readiness Agent.
- Executive Brief Agent.

## 39.4. Sales Copilot

- Tóm tắt khách.
- Tóm tắt hội thoại.
- Gợi ý câu hỏi.
- Gợi ý Next Action.
- Draft Follow-up.
- Tìm tài liệu Approved.
- Draft Proposal.

## 39.5. Executive Brief Agent

Có thể tổng hợp:

- Revenue.
- Pipeline.
- Deal Risk.
- Overdue Follow-up.
- Program Risk.
- Entitlement Risk.
- Customer Issue.
- Decision Required.

## 39.6. Guardrails

- Source-aware Response.
- Permission-aware.
- Tool Scope.
- Approval.
- Audit.
- Rate Limit.
- Sandbox.
- Error Handling.
- Kill Switch.

## 39.7. Exit Gate MVP 5

- A.I không bypass Permission.
- Tool Audit đầy đủ.
- Write Action quan trọng có Approval.
- Không tự bịa giá/quyền lợi/chính sách.
- Người dùng thấy nguồn dữ liệu liên quan khi cần.
- Agent lỗi không làm hỏng Workflow chính.
- Có thể tắt Agent mà hệ thống nghiệp vụ vẫn chạy.

## 39.8. Case đào tạo

> **“Brain First – A.I Second: Agent chỉ mạnh khi Data + Workflow đã chuẩn.”**

---

# 40. EXIT GATE GIỮA CÁC BẬC

Không dùng duy nhất tiêu chí “đã chạy 1 tháng”.

Mỗi bậc cần vượt các Gate sau.

## 40.1. Business Gate

- Có người dùng thật.
- Có tình huống thật.
- Giải quyết đúng Pain Point.
- Người dùng xác nhận đầu ra có giá trị.

## 40.2. Adoption Gate

- Người dùng dùng hệ thống thay cách cũ trong scope đã chuyển.
- Không duy trì hai hệ thống song song nếu không có lý do.

## 40.3. Data Gate

- Không mất dữ liệu.
- Duplicate được kiểm soát.
- Mandatory Fields đủ.
- Record quan trọng có Owner.

## 40.4. Security Gate

- RBAC Test Pass.
- Critical Permission đúng.
- Không bypass API/Endpoint.

## 40.5. Reliability Gate

- Backup Pass.
- Restore Pass.
- Critical Flow Test Pass.
- Error Monitoring hoạt động.

## 40.6. Documentation Gate

- ERD cập nhật.
- SOP cập nhật.
- Deployment Guide cập nhật.
- Release Notes cập nhật.
- Config Guide cập nhật.

## 40.7. Learning Gate

- Có tổng kết.
- Có Lesson Learned.
- Có Improvement Backlog.
- Có Case Study.
- Có nội dung có thể tái sử dụng để đào tạo.

---

# 41. MIGRATION TỪ NOTION / SHEET / ZALO

Không Big Bang.

## 41.1. Nguyên tắc

Một module chỉ thay hệ thống cũ khi:

- Module mới chạy ổn.
- Data Migration verified.
- Người dùng được hướng dẫn.
- Có Rollback Plan.
- Source of Record đã chuyển rõ.

## 41.2. Thứ tự gợi ý

### Đợt 1

**Customer + Pipeline + Follow-up**

Mục tiêu: CRM trở thành nguồn chính của Sale.

### Đợt 2

**Handover + Entitlement**

Mục tiêu: nối Sale sang Delivery.

### Đợt 3

**Program Checklist**

Mục tiêu: giảm phụ thuộc Notion/Sheet cho chương trình.

### Đợt 4

**CSKH**

Mục tiêu: gom sau bán vào Customer 360.

### Đợt 5

**Automation/Interaction**

Mục tiêu: giảm thao tác và rời rạc kênh.

## 41.3. Notion/Drive vẫn giữ cho

- Tài liệu.
- SOP.
- Knowledge.
- Project ngoài scope CRM.
- Các nghiệp vụ chưa được module mới thay.

## 41.4. Không Multi-master

Không để CRM và Notion cùng cho phép sửa một dữ liệu nghiệp vụ cốt lõi mà không rõ hệ thống nào là chính.

---

# 42. TÀI SẢN ĐÀO TẠO VÀ CHUYỂN GIAO

Mỗi MVP phải sinh ra 4 nhóm tài sản.

## 42.1. Product Asset

- Working Software.
- Demo Data.
- Release Notes.
- User Guide.

## 42.2. Engineering Asset

- Source Code.
- ERD.
- ADR.
- Tests.
- Deploy Guide.
- Backup/Restore.
- Security Checklist.
- Migration Scripts.

## 42.3. Training Asset

- Case Study.
- Lesson Plan.
- Slide.
- Exercise.
- Prompt.
- Skill.
- SOP.
- Anti-pattern.
- Before/After.
- Video/Demo nếu cần.

## 42.4. Transfer Asset

- Installation Guide.
- Config Guide.
- Seed Template.
- Branding Guide.
- Permission Template.
- Pipeline Template.
- Product Template.
- Entitlement Template.
- Acceptance Checklist.

Đây là cách biến chi phí R&D thành tài sản **“Làm 1 dùng N”**.

---

# 43. CÁC QUYẾT ĐỊNH PHẢI CHỐT TRƯỚC KHI CODE

## Quyết định 1 — Pipeline MVP

Chọn đúng 01:

- B2C.
- Inhouse/B2B.
- A.I Implementation.

Không làm cả ba ngay.

## Quyết định 2 — Customer Object Model

Chốt quan hệ:

- Contact.
- Company.
- Customer.
- Lead.
- Deal.

## Quyết định 3 — Unique Identity

Phone/Email/Identity nào dùng để chống trùng.

## Quyết định 4 — Ownership

- Ai sở hữu khách?
- Khi nào nhả?
- Khi nào chuyển?
- Sale nghỉ thì sao?
- Người hỗ trợ có quyền gì?

## Quyết định 5 — Role/Permission

Ma trận quyền v1.

## Quyết định 6 — Product/Entitlement

Chốt Product Master và Entitlement Template.

## Quyết định 7 — Handover

Mandatory Fields.

## Quyết định 8 — Payment

Nguồn sự thật thực thu.

## Quyết định 9 — System of Record

Notion/Drive/CRM/Finance: ai ghi gì.

## Quyết định 10 — Stack

Phê duyệt ADR.

## Quyết định 11 — Migration Scope

Data nào migrate ngay, Data nào để Archive/Read-only.

---

# 44. BACKLOG ƯU TIÊN

## P0 — Must Have để có CRM MVP

- Auth.
- User.
- Role.
- Permission.
- Team.
- Customer.
- Search.
- Duplicate Check.
- Lead.
- Assignment.
- Pipeline.
- Stage.
- Activity.
- Next Action.
- Task.
- Follow-up.
- Lost Reason.
- Audit.
- Sale Dashboard.
- Leader Dashboard.
- Backup/Restore.

## P1 — Revenue & Handover

- Product.
- Proposal.
- Discount Approval.
- Contract Reference.
- Order.
- Payment Schedule.
- Handover.
- Entitlement.

## P2 — Delivery

- Program.
- Session.
- Learner.
- Checklist.
- Resource.
- Conflict.
- Program Closure.

## P3 — Customer Success

- Ticket.
- Feedback.
- Membership.
- Renewal.
- Upsell.
- Cross-sell.
- Referral.

## P4 — Integration & Automation

- Facebook.
- Zalo.
- Email.
- Forms.
- Notifications.
- Event Workflow.
- Integration Monitoring.

## P5 — A.I

- Copilot.
- MCP.
- Agent.
- Executive Brief.
- Signal Monitoring.

---

# 45. KẾT LUẬN

ABM không nên xây một CRM theo nghĩa truyền thống.

ABM nên xây:

# ABM REVENUE & CUSTOMER OPERATIONS SYSTEM

Trong đó CRM là lõi của dữ liệu và quan hệ khách hàng, còn hệ thống đích quản trị xuyên suốt:

**Data  
→ Lead  
→ Sale  
→ Deal  
→ Revenue  
→ Handover  
→ Delivery  
→ Entitlement  
→ Customer Success  
→ Expansion Revenue  
→ Management**

Chiến lược phát triển không phải:

> **“Xây hết một nền tảng All-in-One rồi mới đem dùng.”**

Mà là:

> **Giải một lát cắt thật  
> → chạy thật  
> → kiểm chứng  
> → Kaizen  
> → tài liệu hóa  
> → biến thành bài giảng  
> → tái sử dụng  
> → chuyển giao.**

Công thức phát triển cốt lõi:

**REAL BUSINESS PROBLEM  
→ CLEAN DATA MODEL  
→ ONE WORKING VERTICAL SLICE  
→ SAFE VIBE CODING  
→ REAL USAGE  
→ EXIT GATE  
→ KAIZEN  
→ DOCUMENT & TEACH  
→ REUSE & TRANSFER**

Đây là cách ABM áp dụng đồng thời:

**Brain First – A.I Second**

và

**Làm 1 dùng N**

vào chính quá trình xây dựng sản phẩm phần mềm của mình.

---

# PHỤ LỤC A — NGUYÊN TẮC ƯU TIÊN PHÁT TRIỂN

Trước mỗi Feature, đội phát triển phải trả lời:

1. Vấn đề gì đang được giải quyết?
2. Ai là người dùng thật?
3. Quy trình nào thay đổi?
4. Data nào là đầu vào?
5. Output nào phải tạo?
6. Ai chịu trách nhiệm?
7. Nếu lỗi thì hậu quả gì?
8. Có cần Approval không?
9. Có cần Audit không?
10. KPI nào chứng minh Feature có giá trị?
11. Feature này có tạo được tài sản đào tạo/chuyển giao không?
12. Có thể làm đơn giản hơn không?

---

# PHỤ LỤC B — NGUYÊN TẮC “KHÔNG XÂY VÌ PHẦN MỀM KHÁC CÓ”

Không phát triển Feature chỉ vì:

- HubSpot có.
- Salesforce có.
- Zoho có.
- Lark có.
- Notion có.
- Đối thủ có.

Chỉ phát triển khi:

- ABM có nhu cầu thật.
- Hoặc Feature là nền kiến trúc bắt buộc.
- Hoặc đã có case chuyển giao xác nhận nhu cầu.

---

# PHỤ LỤC C — CHECKLIST TRƯỚC MỖI RELEASE

## Business

- [ ] Scope đúng PRD.
- [ ] User owner xác nhận.
- [ ] Workflow đã test.

## Data

- [ ] Migration được review.
- [ ] Không mất Data.
- [ ] Duplicate được kiểm tra.

## Security

- [ ] RBAC test.
- [ ] Sensitive action test.
- [ ] Secret không commit.

## Reliability

- [ ] Backup có.
- [ ] Restore có thể thực hiện.
- [ ] Rollback plan có.

## Engineering

- [ ] Test pass.
- [ ] Error log rõ.
- [ ] Documentation cập nhật.

## Training Asset

- [ ] Ghi lại bài học.
- [ ] Ghi lại Prompt/Workflow hữu ích.
- [ ] Cập nhật Case Study.

---

# PHỤ LỤC D — SƠ ĐỒ TỔNG THỂ

```text
                         ┌─────────────────────────────┐
                         │        CORE / IDENTITY      │
                         │ User · Role · Team · RBAC   │
                         └──────────────┬──────────────┘
                                        │
                              ┌─────────▼─────────┐
                              │   CUSTOMER 360     │
                              │ Single Source Truth│
                              └─────────┬─────────┘
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          │                             │                             │
   ┌──────▼──────┐               ┌──────▼──────┐              ┌──────▼──────┐
   │ LEAD / CRM  │               │ SALES       │              │ OMNICHANNEL │
   │ Pipeline    │               │ Product     │              │ Messages    │
   │ Follow-up   │               │ Proposal    │              │ Email/Zalo  │
   │ Activity    │               │ Contract    │              │ Facebook    │
   └──────┬──────┘               │ Order       │              └──────┬──────┘
          │                      └──────┬──────┘                     │
          └─────────────────────────────┼─────────────────────────────┘
                                        │
                               ┌────────▼────────┐
                               │   HANDOVER      │
                               │ Gate + Change   │
                               └────────┬────────┘
                                        │
                     ┌──────────────────┼──────────────────┐
                     │                  │                  │
              ┌──────▼──────┐    ┌──────▼──────┐   ┌──────▼──────┐
              │ PROGRAM OPS │    │ ENTITLEMENT │   │ CUSTOMER    │
              │ Checklist   │    │ Membership  │   │ SUCCESS     │
              │ Resources   │    │ Fulfillment │   │ Ticket/NPS  │
              └──────┬──────┘    └──────┬──────┘   └──────┬──────┘
                     │                  │                  │
                     └──────────────────┼──────────────────┘
                                        │
                               ┌────────▼────────┐
                               │ RETENTION /     │
                               │ UPSELL / REFERRAL│
                               └────────┬────────┘
                                        │
               ┌────────────────────────┼────────────────────────┐
               │                        │                        │
        ┌──────▼──────┐          ┌──────▼──────┐         ┌──────▼──────┐
        │ DASHBOARD   │          │ AUTOMATION  │         │ A.I / MCP   │
        │ MANAGEMENT  │          │ WORKFLOW    │         │ AGENTS      │
        └─────────────┘          └─────────────┘         └─────────────┘
```

---

**Hết tài liệu PRD v2.1**
