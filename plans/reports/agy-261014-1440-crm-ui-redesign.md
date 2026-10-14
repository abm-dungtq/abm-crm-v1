# Báo Cáo Đánh Giá Hiện Trạng & Đề Xuất Thiết Kế Lại Giao Diện Toàn Diện (ABM CRM)

- **Ngày thực hiện:** 14/10/2026
- **Phạm vi kiểm toán:** Toàn bộ mã nguồn giao diện `apps/crm/src/web/**` (1 file CSS toàn cục + 6 components dùng chung + 26 trang màn hình) và đối chiếu trực tiếp với 3 ảnh chụp màn hình (`2.png`, `3.png`, `4.png`).
- **Bản mẫu (Mockup) tĩnh đi kèm:** `D:\TQD\CRM\plans\reports\ui-mockup-261014-inbox.html` (Tự chứa 100%, mở trực tiếp bằng trình duyệt không cần mạng).

> **Design Read (Định vị ngôn ngữ thiết kế theo chuẩn `ak-frontend-design`):**
> *Reading this as: omnichannel CRM & admissions workspace for Vietnamese sales, academic, and operations teams, with a high-density operational language, leaning Neo-grotesque product + Swiss editorial precision.*
> *(Hiểu đơn giản: Đây là bàn làm việc đa kênh dành cho đội ngũ Tư vấn tuyển sinh, Chăm sóc doanh nghiệp B2B, Giáo vụ và Kế toán học phí tại Việt Nam. Giao diện cần mật độ thông tin cao, gọn gàng, nhìn lướt 2 giây là thấy việc cần làm, kết hợp độ tương phản sắc nét của khung điều hướng tối và sự sáng sủa, chuẩn xác của vùng dữ liệu sáng).*

---

## MỤC 1. KIỂM TOÁN HIỆN TRẠNG GIAO DIỆN (UI AUDIT TOÀN HỆ THỐNG)

### 1.1. Giải thích ngắn gọn các thuật ngữ thiết kế dùng trong báo cáo
Để dễ theo dõi, dưới đây là giải nghĩa bình dân cho 6 khái niệm thiết kế cốt lõi:
1. **Full-bleed Workspace (Không gian làm việc tràn màn hình):** Giao diện tự động giãn hết 100% chiều ngang màn hình máy tính của nhân viên, thay vì bị bó cứng ở một khung nhỏ bên trái rồi bỏ trống một mảng trắng lớn bên phải.
2. **Visual Density (Mật độ hiển thị):** Lượng thông tin hữu ích nhìn thấy ngay trên một màn hình mà không cần cuộn chuột. Mật độ quá thưa làm màn hình trông trống rỗng; mật độ tốt giúp nhân viên thấy ngay SĐT, kênh chat, trạng thái Lead và hạn xử lý (SLA).
3. **Information Hierarchy (Phân cấp thị giác):** Cái gì quan trọng nhất (Tên khách, Số tiền, Cảnh báo quá hạn) phải to, đậm hoặc có màu nổi bật; cái gì phụ (Mã ID, giờ tạo) phải nhỏ và nhạt hơn để mắt không bị rối.
4. **Affordance (Gợi ý tương tác):** Nhìn vào một phần tử là biết ngay có bấm được hay không (ví dụ: nút chuyển chế độ AI/Nhân viên phải trông như công tắc đang bật/tắt rõ ràng, thay vì 3 nút trắng giống hệt nhau).
5. **Progressive Disclosure (Hiển thị theo ngữ cảnh):** Chỉ hiện biểu mẫu (form) khi nhân viên cần nhập liệu (qua ngăn kéo trượt từ bên phải - *Drawer* hoặc cửa sổ nổi - *Modal*), không bày sẵn cả chục ô nhập liệu trống trơn chiếm mất nửa màn hình.
6. **Design Tokens (Biến thiết kế chuẩn hóa):** Bộ quy tắc màu sắc, cỡ chữ, khoảng cách cố định dùng chung toàn phần mềm để mọi trang đều đồng bộ.

---

### 1.2. Nguyên nhân gốc rễ khiến giao diện hiện tại trông "Trống trải" và "Thô sơ" (Đối chiếu ảnh `2.png` với mã nguồn)

Qua kiểm tra trực tiếp file [`apps/crm/src/web/styles.css`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css) (dài 515 dòng, viết tay hoàn toàn, không dùng thư viện UI), có **5 lỗi kiến trúc bố cục** gây ra hiện tượng như trong ảnh chụp `2.png`:

#### Lỗi gốc 1: Khóa cứng chiều rộng `.content { max-width: 1440px }` gây lãng phí 25%–30% màn hình bên phải
- **Vị trí mã nguồn:** [`apps/crm/src/web/styles.css:169`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css#L169)
  ```css
  .content { padding: 20px 24px 48px; width: 100%; max-width: 1440px; }
  ```
- **Tại sao gây lỗi trên ảnh `2.png`:** Trên màn hình Full HD (1920px) hoặc 2K (2560px), thanh menu trái chiếm `232px` ([`styles.css:103`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css#L103)), phần `.content` bị chặn ở `1440px` và **không hề căn giữa cũng không cho phép tràn viền**. Kết quả là toàn bộ dải bên phải rộng từ `248px` đến `880px` biến thành một mảng xám trống rỗng vô nghĩa, trong khi cột thông tin bên phải của Inbox lại bị ép nghẹt chỉ còn đúng `280px` ([`styles.css:444`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css#L444)).

#### Lỗi gốc 2: Lưới 2 cột lệch `.cols-main` (`1fr` + `360px`) bị lạm dụng trên 9 màn hình khác nhau
- **Vị trí mã nguồn:** [`apps/crm/src/web/styles.css:243`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css#L243)
  ```css
  .cols-main { grid-template-columns: minmax(0, 1fr) 360px; }
  ```
- **Hệ quả:** Cấu trúc này được copy-paste vào [`dashboard.tsx:59`](file:///D:/TQD/CRM/apps/crm/src/web/pages/dashboard.tsx#L59), [`lead-detail.tsx:81`](file:///D:/TQD/CRM/apps/crm/src/web/pages/lead-detail.tsx#L81), [`customers.tsx:92`](file:///D:/TQD/CRM/apps/crm/src/web/pages/customers.tsx#L92), [`learner-detail.tsx:132`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learner-detail.tsx#L132), [`courses.tsx:59`](file:///D:/TQD/CRM/apps/crm/src/web/pages/courses.tsx#L59), [`class-detail.tsx:48`](file:///D:/TQD/CRM/apps/crm/src/web/pages/class-detail.tsx#L48), [`fees.tsx:69`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fees.tsx#L69), [`products.tsx:29`](file:///D:/TQD/CRM/apps/crm/src/web/pages/products.tsx#L29), [`partner-detail.tsx:46`](file:///D:/TQD/CRM/apps/crm/src/web/pages/partner-detail.tsx#L46). Khi cột trái chỉ có 1-2 dòng dữ liệu mà cột phải lại nhồi nhét tới 2 biểu mẫu nhập liệu dài (như ở trang Học phí hoặc Đào tạo), toàn bộ nửa bên trái màn hình bị bỏ trắng.

#### Lỗi gốc 3: Bộ icon quá nghèo nàn và không có nhận diện màu sắc theo Kênh (Channel Identity)
- **Vị trí mã nguồn:** [`apps/crm/src/web/components/icons.tsx:14-126`](file:///D:/TQD/CRM/apps/crm/src/web/components/icons.tsx#L14-L126)
- **Hệ quả:** Toàn bộ hệ thống chỉ có 29 icon nét mảnh đơn sắc (`strokeWidth="1.75"`). Không có logo/biểu tượng riêng cho **Zalo cá nhân**, **Zalo OA (Official Account)**, **Zalo Nhóm**, **Facebook Fanpage**, không có icon ghim (`pin`), ngôi sao (`star`), đính kèm tệp (`paperclip`), trạng thái đã xem (`✓✓`), hay mũi tên xu hướng tăng/giảm (`trend`). Nhân viên phải đọc chữ thuần túy (`zalo_oa`, `facebook`) thay vì nhận diện bằng mắt trong 0.2 giây như ở ảnh `3.png` và `4.png`.

#### Lỗi gốc 4: Component `<Avatar>` đã viết sẵn nhưng bị bỏ quên ở hầu hết các danh sách quan trọng
- **Vị trí mã nguồn:** [`apps/crm/src/web/components/ui.tsx:86-98`](file:///D:/TQD/CRM/apps/crm/src/web/components/ui.tsx#L86-L98)
- **Hệ quả:** Dù `ui.tsx` đã có component `<Avatar name={...} />`, nhưng danh sách hội thoại Inbox ([`inbox.tsx:149-168`](file:///D:/TQD/CRM/apps/crm/src/web/pages/inbox.tsx#L149-L168)), bong bóng tin nhắn ([`inbox-thread.tsx:84-109`](file:///D:/TQD/CRM/apps/crm/src/web/components/inbox-thread.tsx#L84-L109)), bảng Học viên ([`learners.tsx:96-143`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learners.tsx#L96-L143)), và bảng Khách hàng ([`customers.tsx:99-119`](file:///D:/TQD/CRM/apps/crm/src/web/pages/customers.tsx#L99-L119)) đều **không sử dụng Avatar**, làm danh sách trông khô khan như bảng tính thô.

---

### 1.3. Kiểm toán chi tiết từng phân hệ màn hình (Kèm tọa độ file & dòng code)

#### A. Khung điều hướng chung (App Shell: Sidebar, Topbar, Sub-tabs)
- **Files:** [`apps/crm/src/web/components/layout.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/components/layout.tsx), [`apps/crm/src/web/styles.css:101-196`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css#L101-L196)
- **Điểm yếu cụ thể:**
  1. **Menu trái (`layout.tsx:53-98`) thiếu hoàn toàn số đếm thông báo (Unread/Queue Badges):** Nhân viên đang ở trang Lead hoặc Học phí sẽ không biết Inbox đang có bao nhiêu tin nhắn chưa đọc hay bao nhiêu công việc quá hạn.
  2. **Các trang con bị giấu vào thanh `.section-tabs` (`layout.tsx:101-130, 167-184`) và tự biến mất khi vào trang chi tiết:** Tại [`layout.tsx:167`](file:///D:/TQD/CRM/apps/crm/src/web/components/layout.tsx#L167), điều kiện `subTabs && (loc === subTabs[0].to || subTabs.some((t) => loc === t.to))` khiến thanh tab con **biến mất ngay lập tức** khi bấm vào xem chi tiết 1 Lead (`/leads/:id`) hoặc 1 Học viên (`/learners/:id`), làm người dùng mất phương hướng quay lại.
  3. **Nút `+ Tạo lead` trên Topbar (`layout.tsx:143-147`) bị gắn cứng vào `/leads/new`:** Trang `/leads/new` ([`lead-new.tsx:26`](file:///D:/TQD/CRM/apps/crm/src/web/pages/lead-new.tsx#L26)) mặc định tạo Lead doanh nghiệp B2B, trong khi phần lớn hoạt động hàng ngày còn có tạo Học viên tuyển sinh, tạo Khoản thu học phí, tạo Công việc.

#### B. Phân hệ Inbox Đa Kênh (Trọng tâm đối chiếu 3 khoanh đỏ trên ảnh `2.png`)
- **Files:** [`pages/inbox.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/inbox.tsx), [`components/inbox-thread.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/components/inbox-thread.tsx), [`components/intake-card.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/components/intake-card.tsx), [`styles.css:425-514`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css#L425-L514)
- **Giải phẫu 3 điểm khoanh đỏ trên ảnh `2.png`:**
  1. **Khoanh đỏ 1 — Thẻ hội thoại `[khách A]` bên cột trái ([`inbox.tsx:149-168`](file:///D:/TQD/CRM/apps/crm/src/web/pages/inbox.tsx#L149-L168), [`styles.css:434-441`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css#L434-L441)):**
     - Chỉ có 3 dòng chữ xếp chồng (`.conv-name`, `.preview`, `.conv-meta`).
     - Không có Avatar chữ cái đầu hay ảnh đại diện khách.
     - Không có huy hiệu logo kênh (Zalo OA / Zalo cá nhân / Facebook).
     - Không có chấm đỏ đếm số tin nhắn chưa đọc (`unread count`) và không có thẻ nhãn phân loại (VIP, Đã gắn Lead, Quá hạn SLA).
     - Ba tab lọc `Của tôi`, `Chưa giao`, `Tất cả` ([`inbox.tsx:113-117`](file:///D:/TQD/CRM/apps/crm/src/web/pages/inbox.tsx#L113-L117)) không hiển thị con số đếm cụ thể (ví dụ `Chưa giao (9)`).
  2. **Khoanh đỏ 2 — Khối `Người được giao` và `Chế độ` ở cột phải ([`inbox.tsx:180-199`](file:///D:/TQD/CRM/apps/crm/src/web/pages/inbox.tsx#L180-L199)):**
     - Đặt một ô `<select>` thô sơ chiếm nguyên chiều ngang cho "Người được giao", ngay bên dưới là 3 nút bấm rời rạc (`Tiếp quản`, `Trả lại AI`, `Tạm dừng`) chiếm thêm một tầng diện tích lớn. Đáng lẽ thông tin Người phụ trách và Công tắc chuyển chế độ (`AI / Nhân viên / Tạm dừng`) phải nằm gọn ngay trên **Thanh tiêu đề cuộc trò chuyện (Thread Header)** để nhường toàn bộ cột phải cho Hồ sơ Khách hàng 360 & Lead.
  3. **Khoanh đỏ 3 — Lỗi nghiệp vụ & hiển thị nghiêm trọng: `"Lead chờ phân loại: Chưa có"` ngay cả khi đã tạo Lead ([`intake-card.tsx:35-69`](file:///D:/TQD/CRM/apps/crm/src/web/components/intake-card.tsx#L35-L69) & [`inbox.tsx:200-206`](file:///D:/TQD/CRM/apps/crm/src/web/pages/inbox.tsx#L200-L206)):**
     - **Bằng chứng trong code:** Tại [`intake-card.tsx:38-40`](file:///D:/TQD/CRM/apps/crm/src/web/components/intake-card.tsx#L38-L40), component `IntakeCard` chỉ gọi API lấy các bản ghi có `status: 'pending'`:
       ```ts
       const list = await api.listIntakes({ status: 'pending', conversationId: conversation.id });
       ```
     - Khi nhân viên bấm nút phân loại thành Lead Học viên (`learner`) hoặc B2B (`b2b`), bản ghi Intake chuyển sang trạng thái `'classified'`, đồng thời trường `conversation.contactId` đã được lưu trên đối tượng `InboxConversation` ([`types.ts:267`](file:///D:/TQD/CRM/apps/crm/src/web/types.ts#L267)).
     - Tuy nhiên, [`ConversationPanel` (`inbox.tsx:177-208`)](file:///D:/TQD/CRM/apps/crm/src/web/pages/inbox.tsx#L177-L208) **hoàn toàn bỏ qua `conversation.contactId`**, không hề truy vấn thông tin Contact hay danh sách Lead đang gắn với Contact đó! Hệ quả là vừa bấm tạo Lead xong, màn hình quay lại báo *"Lead chờ phân loại: Chưa có. Bot trích thông tin khách từ cuộc trò chuyện sẽ hiện ở đây"*, khiến nhân viên tưởng hệ thống bị mất dữ liệu và không có nút nào để bấm sang hồ sơ Lead vừa tạo.

#### C. Phân hệ Tổng quan & Báo cáo (Dashboard, Overview, Learner Reports)
- **Files:** [`pages/dashboard.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/dashboard.tsx), [`pages/overview.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/overview.tsx), [`pages/learner-reports.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learner-reports.tsx)
- **Điểm yếu cụ thể:**
  1. **Thẻ chỉ số `.kpi` ([`styles.css:248-254`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css#L248-L254), [`ui.tsx:206-214`](file:///D:/TQD/CRM/apps/crm/src/web/components/ui.tsx#L206-L214)) quá đơn điệu:** Chỉ gồm 2 dòng chữ đen trắng, không có icon đại diện, không có huy hiệu phần trăm tăng/giảm (`+12%`), không có thanh tiến độ mục tiêu (progress bar).
  2. **Trang Báo cáo học viên ([`learner-reports.tsx:54-225`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learner-reports.tsx#L54-L225)) xếp chồng 11 bảng nhỏ theo chiều dọc:** Thay vì chia lưới 2–3 cột cho các bảng thống kê ngắn (như Nguồn lead, Ngành nghề, Khu vực, Độ tuổi — mỗi bảng chỉ có 2 cột là Tên và Số lượng), code hiện tại bọc tất cả trong `<div className="grid">` 1 cột duy nhất ([`learner-reports.tsx:54`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learner-reports.tsx#L54)), làm mỗi bảng kéo dài hết chiều ngang với 80% diện tích là khoảng trắng giữa cột trái và cột phải.

#### D. Phân hệ Quản lý Lead (Pipeline Kanban, Danh sách Lead, Chi tiết Lead)
- **Files:** [`pages/pipeline.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/pipeline.tsx), [`pages/leads.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/leads.tsx), [`pages/lead-detail.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/lead-detail.tsx), [`pages/lead-new.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/lead-new.tsx)
- **Điểm yếu cụ thể:**
  1. **Tách rời Kanban (`/pipeline`) và Bảng danh sách (`/leads`) thành 2 trang độc lập:** Trong các CRM hiện đại, Kanban và Table là 2 chế độ xem (View Switcher) trên cùng một màn hình kèm dải KPI tổng giá trị cơ hội ở trên đầu.
  2. **Thẻ Kanban (`.kanban-card` tại [`pipeline.tsx:86-127`](file:///D:/TQD/CRM/apps/crm/src/web/pages/pipeline.tsx#L86-L127)) thiếu thông tin liên lạc nhanh:** Không hiển thị SĐT, không có nút mở nhanh cuộc trò chuyện Zalo/FB liên kết, và thanh `<select>` chuyển giai đoạn ở đáy mỗi thẻ ([`pipeline.tsx:109-121`](file:///D:/TQD/CRM/apps/crm/src/web/pages/pipeline.tsx#L109-L121)) làm thẻ bị cao và thô.
  3. **Trang Chi tiết Lead ([`lead-detail.tsx:79-227`](file:///D:/TQD/CRM/apps/crm/src/web/pages/lead-detail.tsx#L79-L227)):** Khối thông tin bên phải dùng `<dl className="dl">` ([`lead-detail.tsx:161-177`](file:///D:/TQD/CRM/apps/crm/src/web/pages/lead-detail.tsx#L161-L177)) chỉ hiện 5 dòng chữ trơ trụi, không nhúng luồng tin nhắn gần nhất từ Inbox và không có nút gọi/nhắn Zalo trực tiếp.

#### E. Phân hệ Khách hàng 360, Học viên & Đối tác
- **Files:** [`pages/customers.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/customers.tsx), [`pages/learners.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learners.tsx), [`pages/learner-detail.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learner-detail.tsx), [`pages/partners.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/partners.tsx), [`pages/partner-detail.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/partner-detail.tsx)
- **Điểm yếu cụ thể:**
  1. **Trang `/customers` ([`customers.tsx:92-193`](file:///D:/TQD/CRM/apps/crm/src/web/pages/customers.tsx#L92-L193)) đặt sẵn 2 form tạo mới (`Tạo tổ chức mới` và `Tạo liên hệ mới`) cố định ở cột phải:** Dù 95% thời gian nhân viên vào trang này là để **tra cứu khách hàng**, 2 biểu mẫu nhập liệu vẫn chiếm cứng cột phải `360px`.
  2. **Trang Chi tiết Học viên ([`learner-detail.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learner-detail.tsx), dài 548 dòng) bị quá tải biểu mẫu:** Nhồi nhét cùng lúc Hồ sơ Lead, Nhật ký hoạt động, Form sửa thông tin cá nhân, Gói học đăng ký, Ghi danh lớp, và 3 ô tích Quyền riêng tư (Consent) trên cùng một mặt phẳng mà không chia theo Tab (`Hồ sơ & Cơ hội`, `Lớp học & Điểm danh`, `Học phí & Hóa đơn`, `Lịch sử Chat`).

#### F. Phân hệ Đào tạo (Khóa học, Chi tiết Lớp, Điểm danh, Gói học)
- **Files:** [`pages/courses.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/courses.tsx), [`pages/class-detail.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/class-detail.tsx), [`pages/my-classes.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/my-classes.tsx), [`pages/session-attendance.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/session-attendance.tsx), [`pages/products.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/products.tsx)
- **Điểm yếu cụ thể:**
  1. **Danh sách ghi danh trong Chi tiết Lớp ([`class-detail.tsx:118-167`](file:///D:/TQD/CRM/apps/crm/src/web/pages/class-detail.tsx#L118-L167)) và Buổi học ([`class-detail.tsx:215-248`](file:///D:/TQD/CRM/apps/crm/src/web/pages/class-detail.tsx#L215-L248)):** Không dùng bảng (`<table>`) mà nhét cả ô `<input placeholder="Lý do nghỉ / ghi chú">`, `<select>`, và 4 nút bấm (`Bảo lưu`, `Chuyển lớp`, `Hủy ghi danh`) nằm ngang trong một thẻ `<li>` flex-wrap. Khi tên học viên dài, các nút bị rớt dòng lộn xộn.
  2. **Màn hình Điểm danh ([`session-attendance.tsx:86-123`](file:///D:/TQD/CRM/apps/crm/src/web/pages/session-attendance.tsx#L86-L123)):** Mỗi học viên bị vẽ thành một hộp dọc chiếm cả chiều ngang thay vì một bảng lưới điểm danh nhanh (Segmented Toggle: `Có mặt | Đi muộn | Vắng có phép | Vắng không phép` trên từng dòng kèm nút `Đánh dấu tất cả Có mặt`).

#### G. Phân hệ Học phí & Đối soát (Fees, Queue, Ledger, Fee Guide)
- **Files:** [`pages/fees.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fees.tsx), [`pages/fees-queue.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fees-queue.tsx), [`pages/fees-ledger.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fees-ledger.tsx), [`pages/fee-guide.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fee-guide.tsx)
- **Điểm yếu cụ thể:**
  1. **Thiếu dải KPI Tài chính ở đầu trang `/fees` ([`fees.tsx:52-123`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fees.tsx#L52-L123)):** Kế toán vào trang Học phí nhưng không thấy Tổng phải thu, Tổng đã thu trong tháng, Tổng công nợ quá hạn, và Số khoản tiền treo chưa phân bổ.
  2. **Cột thao tác trên bảng Khoản thu ([`fees.tsx:96-109`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fees.tsx#L96-L109)) quá chật:** Nhét 4 nút dài (`Sổ tiền`, `Hướng dẫn chuyển khoản`, `Số hóa đơn`, `Hủy khoản`) vào một ô `<td>`, trong khi cột phải lại bị 2 form `Tạo khoản thu mới` và `Ghi nhận thanh toán` ([`fees.tsx:118-121`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fees.tsx#L118-L121)) ép mất `360px`.
  3. **Trang Hướng dẫn chuyển khoản ([`fee-guide.tsx:41-81`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fee-guide.tsx#L41-L81)):** Chỉ hiện 3 hộp chữ khô khan, thiếu khung hiển thị **Mã QR Chuyển khoản (VietQR)** và nút **"Sao chép toàn bộ nội dung gửi học viên qua Zalo"**.

#### H. Phân hệ Công việc (`/tasks`), Cài đặt Kênh (`/channel-accounts`) & Quản trị (`/admin`)
- **Files:** [`pages/tasks.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/tasks.tsx), [`pages/channel-accounts.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/channel-accounts.tsx), [`pages/zalo-groups.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/zalo-groups.tsx), [`pages/admin.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/admin.tsx)
- **Điểm yếu cụ thể:**
  1. **Trang Công việc ([`tasks.tsx:46-95`](file:///D:/TQD/CRM/apps/crm/src/web/pages/tasks.tsx#L46-L95)):** Xếp 3 hộp (`Quá hạn`, `Hôm nay`, `Sắp tới`) từ trên xuống dưới, mỗi dòng công việc kéo dài 1400px chỉ có tiêu đề bên trái và nút `Hoàn thành` bên phải, ở giữa trống hoàn toàn. Đáng lẽ nên chia thành **3 cột song song (Board 3 cột: Quá hạn · Hôm nay · Sắp tới)** hoặc bảng có ô tích hoàn thành nhanh.
  2. **Trang Tài khoản kênh ([`channel-accounts.tsx:42-92`](file:///D:/TQD/CRM/apps/crm/src/web/pages/channel-accounts.tsx#L42-L92)):** Xếp chồng 3 khối form cấu hình lớn phía trên bảng danh sách 10 cột, khiến người dùng phải cuộn rất dài mới thấy danh sách các tài khoản Zalo/Facebook đang kết nối.

---

## MỤC 2. ĐỊNH HƯỚNG THIẾT KẾ LẠI TOÀN HỆ THỐNG (WHOLE-CRM DESIGN DIRECTION)

### 2.1. Hệ thống Biến Thiết Kế (Design Tokens) Đề Xuất

Để chấm dứt cảm giác nhạt nhòa hiện tại, hệ thống CSS tại [`apps/crm/src/web/styles.css`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css) cần được nâng cấp lên bộ Token có độ tương phản rõ rệt giữa **Khung điều hướng (Dark Slate)** và **Bàn làm việc dữ liệu (High-Craft Light)**:

#### 1. Bảng màu Bề mặt & Chữ (Surfaces & Ink Hierarchy)
| Nhóm Token | Tên biến CSS | Giá trị mã màu | Mục đích sử dụng thực tế |
| :--- | :--- | :--- | :--- |
| **Điều hướng tối** | `--bg-rail` | `#0B1120` | Thanh điều hướng chính (64px) và Sidebar tối |
| **Cột phụ tối** | `--bg-subnav` | `#111827` | Cột Kênh kết nối & Bộ lọc nhãn trong Inbox |
| **Nền ứng dụng** | `--bg-app` | `#F1F5F9` | Nền tổng thể phía sau các thẻ (Slate 100 dịu mắt) |
| **Bề mặt thẻ/bảng** | `--bg-surface` | `#FFFFFF` | Nền thẻ dữ liệu, bảng, cột danh sách hội thoại |
| **Nền luồng Chat** | `--bg-chat-canvas` | `#F4F6FA` | Nền riêng cho khung đọc tin nhắn để tách biệt bong bóng trắng |
| **Nền đang chọn** | `--bg-selected` | `#EFF6FF` | Dòng hội thoại / dòng bảng đang được mở |
| **Chữ cấp 1 (Đậm)** | `--ink-primary` | `#0F172A` | Tên khách hàng, tiêu đề trang, con số KPI, số tiền |
| **Chữ cấp 2 (Thân)** | `--ink-secondary` | `#334155` | Nội dung tin nhắn, nội dung bảng |
| **Chữ cấp 3 (Phụ)** | `--ink-muted` | `#64748B` | Nhãn trường dữ liệu, mốc thời gian, mô tả phụ |
| **Đường viền chuẩn** | `--border-subtle` | `#E2E8F0` | Đường kẻ chia cột, chia dòng bảng sắc nét (`1px solid`) |

#### 2. Bảng màu Nhận diện Kênh (Channel Identity Tokens — Học từ Reference A & B)
Mỗi kênh giao tiếp phải có một cặp màu đặc trưng (Màu đậm cho Huy hiệu logo ở góc Avatar + Màu nền nhạt cho Thẻ pill):
- **Zalo Official Account (`zalo_oa`):** Chính `#1E40AF` (Royal Blue) · Nền nhạt `#E0E7FF` · Kèm dấu tích vàng xác thực `#F59E0B`.
- **Zalo Cá nhân (`zalo`):** Chính `#0068FF` (Zalo Blue) · Nền nhạt `#DBEAFE`.
- **Zalo Nhóm Lớp học (`zalo_group`):** Chính `#0D9488` (Teal Cổ vịt) · Nền nhạt `#CCFBF1` (giúp phân biệt ngay chat nhóm lớp với chat 1-1).
- **Facebook Fanpage (`facebook`):** Chính `#1877F2` (Messenger Blue) · Nền nhạt `#E0F2FE`.
- **Trợ lý AI / Bot (`agent`):** Chính `#7C3AED` (Violet) · Nền nhạt `#F3E8FF` (mọi tin nhắn hoặc dữ liệu do AI tạo đều mang sắc tím nhẹ này).

#### 3. Thang chữ (Typography Scale) & Mật độ (Spacing Density)
- **Font chữ:** `'Be Vietnam Pro', 'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif` (hiển thị dấu tiếng Việt thoáng, rõ nét ở cỡ nhỏ 11px–13px).
- **Bắt buộc bật `font-variant-numeric: tabular-nums`** cho mọi cột Số điện thoại, Học phí, Thời gian chờ SLA, và Số đếm chưa đọc để các chữ số thẳng hàng dọc tuyệt đối.
- **Thang cỡ chữ 6 bậc:**
  - `10.5px` (Uppercase, đậm `700`): Tiêu đề nhóm mục (`THÔNG TIN LIÊN HỆ`, `HỒ SƠ LEAD`), số đếm huy hiệu.
  - `11.5px`: Nhãn phụ, thời gian, thẻ tag phân loại.
  - `12.5px`–`13px`: Cỡ chữ mặc định toàn hệ thống (tin nhắn, dòng bảng, ô nhập liệu).
  - `14.5px`–`15px` (Đậm `700`): Tiêu đề cuộc trò chuyện, tiêu đề thẻ.
  - `18px`–`22px` (Đậm `700`): Con số KPI tổng hợp.
- **Mật độ dòng (Row Height Targets):**
  - Dòng bảng dữ liệu (`<td>`): Cao `40px` (`padding: 8px 12px`), hiển thị được 18–20 dòng trên màn hình 1080p.
  - Thẻ hội thoại Inbox: Cao `72px`–`78px` (`padding: 11px 12px`), hiển thị vừa vặn 9–10 cuộc trò chuyện cùng lúc kèm đầy đủ Avatar + Kênh + Preview + 3 thẻ Tag.

---

### 2.2. Thiết kế lại Khung Ứng Dụng (App Shell) — Xóa bỏ hoàn toàn khoảng trống chết

1. **Bỏ giới hạn `max-width: 1440px` cho các màn hình vận hành:**
   - Thay đổi `.content` trong [`styles.css:169`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css#L169):
     - Với các màn hình bàn làm việc đa cột (**Inbox, Pipeline Kanban, Chi tiết Lead, Chi tiết Học viên, Điểm danh**): Sử dụng chế độ **Full-Bleed (`max-width: none; padding: 0` hoặc `16px 20px`)**, tận dụng 100% chiều rộng màn hình 1920px–2560px.
     - Với các màn hình đọc báo cáo đơn thuần: Cho phép giãn tới `1680px` và căn giữa (`margin: 0 auto`).
2. **Thanh điều hướng trái Tối (Dark Sidebar / Collapsible Rail):**
   - Chuyển Sidebar sang nền tối `#0B1120` để tạo điểm tựa thị giác vững chắc (như Reference A `3.png`).
   - Khi đang ở màn hình **Inbox**, Sidebar chính tự động thu gọn thành **Thanh Rail `64px`** (chỉ hiện icon + tên ngắn + chấm đỏ số lượng chưa đọc), nhường `236px` kế tiếp cho **Cột Kênh kết nối & Nhãn phân loại nhanh**. Nhờ vậy, màn hình có đủ chỗ cho cả 4 vùng chức năng mà không bị chật.
3. **Topbar đa năng (`54px`):**
   - Gộp các Sub-tabs (`Hội thoại trực tiếp | Hàng đợi AI trích xuất (6) | Nhóm Zalo (14)`) lên ngay cạnh tiêu đề trang để tiết kiệm 1 tầng chiều dọc (`44px`), đồng thời giữ nguyên Sub-tabs khi đi vào trang con.
   - Đổi nút `+ Tạo lead` đơn lẻ thành nút **`+ Tạo mới ▾` (Quick Create Menu)**: Tạo Lead Học viên, Tạo Cơ hội B2B, Tạo Khoản thu học phí, Tạo Công việc.

---

### 2.3. Thiết kế lại chi tiết từng Màn hình Trọng tâm

#### 1. Màn hình Inbox Đa Kênh (Giải pháp kết hợp tinh hoa của `3.png` và `4.png`)
Bố cục chuẩn gồm **Thanh Topbar KPI** + **Cột Kênh kết nối (`236px`)** + **Lưới 3 cột chính (`350px` · `1fr` · `396px`)**:
- **Dải KPI vận hành trên đầu (Học từ `4.png`):** 4 thẻ chip gọn ngay trên thanh công cụ: `Tổng hội thoại (148 · +14%)`, `Nhân viên đang xử lý (24 · AI: 112)`, `Chờ phản hồi >5p (3 · Cần xử lý)`, `Đã gắn Lead hôm nay (19 · 79%)`.
- **Cột Kênh kết nối & Nhãn nhanh (Kết hợp `3.png` & `4.png`):** Liệt kê từng tài khoản (`Tất cả kênh`, `Zalo OA Học viện ABM`, `Zalo TV Tuyển sinh 01`, `Nhóm Zalo Lớp học`, `Facebook Fanpage`) kèm tổng số hội thoại và huy hiệu đỏ số tin chưa đọc. Phía dưới là danh sách Nhãn phân loại nhanh có chấm màu (`VIP C-Level`, `Sắp quá hạn SLA`, `Đã tạo hồ sơ Lead`, `Bot trích xuất chờ duyệt`) và hộp trạng thái `Trợ lý AI Tiếp nhận: ĐANG BẬT`.
- **Pane 1 — Danh sách hội thoại (`350px`):**
  - 4 tab lọc luôn hiện số đếm: `Tất cả (148)`, `Của tôi (24)`, `Chưa giao (9)`, `Chưa đọc (12)`.
  - Mỗi thẻ hội thoại bắt buộc có: **Avatar tròn có màu gradient + Huy hiệu kênh (`OA`, `ZL`, `GR`, `FB`) đè ở góc dưới phải**, Tên khách hàng (kèm ngôi sao nếu đã ghim), Thời gian tin cuối, Dòng xem trước tin nhắn, Huy hiệu đỏ số tin chưa đọc, và hàng thẻ Tag nhỏ ở đáy (`Nhân viên · Lâm Mai`, `✓ Đã gắn Lead #0842`, `⏱ Chờ 12p`).
- **Pane 2 — Luồng tin nhắn chính (`minmax(0, 1fr)`):**
  - **Header cuộc trò chuyện:** Hiển thị Avatar, Tên khách, Huy hiệu kênh, SĐT, và chuyển toàn bộ cụm **Người phụ trách (`Phụ trách: Lâm Mai ▾`)** + **Công tắc 3 chế độ (`AI Tự động | Nhân viên tiếp quản | Tạm dừng`)** lên góc phải Header.
  - **Thanh ngữ cảnh tài khoản (Học từ `3.png`):** Một dải mảnh màu xanh nhạt ngay dưới Header báo rõ: *"Đang nhắn tin qua Zalo OA · Học viện ABM (Cửa sổ tương tác 48h còn hiệu lực: 41 giờ 18 phút)"*.
  - **Luồng bong bóng chat:** Phân biệt rõ 3 kiểu bong bóng: Khách gửi (nền trắng, bên trái), **Trợ lý AI gửi** (nền tím nhạt `#FAF5FF` viền tím, có nhãn `✦ Trợ lý AI ABM`), và **Nhân viên gửi** (nền xanh nhạt `#EFF6FF`, bên phải, kèm dấu đã xem `✓✓`). Hỗ trợ khung trích dẫn tin nhắn trả lời (Quote) và thẻ tệp đính kèm PDF/DOCX có nút tải xuống.
  - **Khung soạn thảo 2 chế độ (Học từ `4.png`):** Có 2 tab `Tin nhắn trả lời khách` (nền trắng) và `Ghi chú nội bộ (Chỉ CSKH thấy)` (tự động đổi sang nền vàng ấm `#FFFBEB` để nhân viên không bao giờ gửi nhầm ghi chú nội bộ cho khách), kèm các chip mẫu câu nhanh (`/vietqr-hoc-phi`, `/lich-khai-giang`).
- **Pane 3 — Hồ sơ Khách hàng 360 & Hồ sơ Lead Liên kết (`396px` — Xử lý dứt điểm lỗi "Lead chờ phân loại: Chưa có"):**
  - **Hàng 4 ô thao tác nhanh ở đầu cột (Học từ `3.png`):** `★ Đã ghim`, `⏰ Hẹn nhắc`, `⇄ Chuyển giao`, `✓ Hoàn tất`.
  - **Khối 1 — Khách hàng đã liên kết (Contact Card):** Khi `conversation.contactId` đã có dữ liệu, hiển thị ngay Tên đầy đủ, Chức vụ/Công ty, SĐT (kèm nút `Sao chép` 1 chạm), Email, Nguồn chiến dịch và các thẻ Tag.
  - **Khối 2 — Hồ sơ Lead đang theo đuổi (Linked Lead Card):** Truy vấn danh sách Lead theo `contactId` (`api.listLeads({ contactId: conversation.contactId })` hoặc hiển thị Lead đã tạo từ Intake `status: 'classified'`). Hiển thị thẻ nổi bật có Mã Lead (`#L-2026-0842`), Giai đoạn hiện tại (`Đang tư vấn lộ trình`), Thanh tiến độ 5 bước trực quan, Giá trị dự kiến (`35.100.000 ₫`), Việc tiếp theo cần làm, và 3 nút thao tác trực tiếp: **`Đổi giai đoạn`**, **`Tạo phiếu thu`**, **`Chi tiết Lead ↗`**, cộng thêm nút **`+ Tạo thêm Lead`** ở góc trên.
  - **Khối 2b — Hộp AI trích xuất thông minh:** Nếu khách chưa có Lead (`contactId == null`), hiện form phân loại nhanh 1 chạm. Nếu khách **đã có Lead**, khối AI thu gọn thành một dải thông báo nhẹ (`✦ AI phát hiện thông tin bổ sung`) để cập nhật thêm SĐT/nhu cầu vào Lead sẵn có chứ **tuyệt đối không bao giờ hiện dòng chữ gây hiểu lầm "Lead chờ phân loại: Chưa có"** nữa!
  - **Khối 3 & 4 — Ghi chú nội bộ (Thẻ vàng từ `3.png`) & Dòng thời gian hoạt động gần đây (Timeline từ `4.png`).**

#### 2. Màn hình Quản lý Lead (Hợp nhất Pipeline Kanban & Danh sách Bảng)
- Gộp `/pipeline` và `/leads` vào một màn hình duy nhất có nút chuyển chế độ xem: **`[ ☷ Bảng Kanban ] [ ☰ Danh sách Bảng ]`**.
- Phía trên là dải 4 thẻ tóm tắt theo Pipeline đang chọn: `Tổng số Lead`, `Tổng giá trị dự kiến (₫)`, `Đang tư vấn nóng`, `Quá hạn liên hệ (SLA)`.
- Trên mỗi thẻ Kanban: Hiển thị Avatar khách, Tên + Tổ chức/Khóa học quan tâm, Số tiền dự kiến (in đậm màu xanh), Huy hiệu kênh nguồn (`Zalo OA`, `FB`), Thời gian hẹn tiếp theo, và nút mở nhanh cửa sổ chat.

#### 3. Màn hình Khách hàng 360 & Học viên (`/customers`, `/learners`, `/learner-detail`)
- **Đưa 2 form tạo mới (`Tạo tổ chức`, `Tạo liên hệ`) vào Modal/Drawer** bấm từ nút `+ Thêm khách hàng` ở góc phải, trả lại 100% chiều ngang cho bảng tra cứu khách hàng.
- **Trong trang Chi tiết Học viên (`/learner-detail`):** Thiết kế lại thành bố cục **Header Hồ sơ Học viên (Avatar, SĐT, Trạng thái giữ chỗ 24h có thanh đếm ngược, Tổng học phí đã đóng/còn thiếu)** + **4 Tab nội dung sạch sẽ**:
  1. `Cơ hội & Tư vấn (Leads & Activities)`
  2. `Gói học & Lớp ghi danh (Products & Classes)`
  3. `Sổ thu Học phí & Hóa đơn (Charges & Ledger)`
  4. `Quyền riêng tư & Hồ sơ gốc (Consents & Info)`

#### 4. Màn hình Tổng quan & Báo cáo (`/dashboard`, `/overview`, `/learner-reports`)
- Nâng cấp component `<Kpi>` ([`ui.tsx:206`](file:///D:/TQD/CRM/apps/crm/src/web/components/ui.tsx#L206)) có thêm: Icon góc phải, Huy hiệu xu hướng (`↑ 14% so với tuần trước`), và chú thích phụ.
- Tại `/learner-reports`: Xếp 11 bảng thống kê vào **Lưới 2 cột và 3 cột (`grid-template-columns: repeat(auto-fit, minmax(380px, 1fr))`)** kèm thanh tỷ lệ phần trăm trực quan (Horizontal Bar) ngay trong ô số lượng để nhìn lướt là thấy kênh nào, tỉnh thành nào mang về nhiều học viên nhất.

#### 5. Màn hình Học phí (`/fees`, `/fees-queue`, `/fee-guide`) & Đào tạo (`/courses`, `/class-detail`, `/session-attendance`)
- **Trang Học phí (`/fees`):** Thêm dải 4 KPI Tài chính ở đầu trang (`Tổng phải thu`, `Đã thu trong kỳ`, `Đang chờ đối soát`, `Công nợ quá hạn`). Đưa 2 form `Tạo khoản thu` và `Ghi nhận thanh toán` vào ngăn kéo trượt (Slide-over Drawer) để bảng danh sách Khoản thu hiển thị rộng rãi, rõ ràng.
- **Trang Hướng dẫn chuyển khoản (`/fee-guide`):** Bổ sung khung hiển thị **Mã VietQR tự động** bên cạnh thông tin số tài khoản, nội dung chuyển khoản chuẩn hóa và nút `Sao chép gửi Zalo`.
- **Trang Điểm danh (`/session-attendance`):** Chuyển sang bảng lưới điểm danh 1 dòng/học viên, có thanh nút chọn nhanh trạng thái (`Có mặt | Đi muộn | Có phép | Không phép`) và nút `Đánh dấu tất cả Có mặt` ở góc bảng.

---

## MỤC 3. BA PHƯƠNG ÁN THỊ GIÁC (3 ALTERNATIVE VISUAL DIRECTIONS) & KHUYẾN NGHỊ

Để ban dự án dễ lựa chọn, dưới đây là 3 phương án định hình phong cách thị giác cho ABM CRM:

### Phương án 1: Light High-Clarity SaaS (Lấy cảm hứng chủ đạo từ Reference B — `4.png`)
- **Cảm giác tổng thể:** Sáng sủa hoàn toàn (nền trắng `#FFFFFF` và xám nhạt `#F8FAFC`), nhẹ nhàng, giống các phần mềm quản lý giáo dục hiện đại (Linear Light / Notion / HubSpot).
- **Ưu điểm:**
  - Gần với bảng màu sáng hiện tại của CRM nhất nên sửa ít biến CSS nhất.
  - Dễ đọc trong phòng làm việc nhiều ánh đèn, cảm giác thân thiện với nhân viên giáo vụ và kế toán.
- **Nhược điểm:**
  - Khi mở màn hình Inbox 4 cột (Menu chính + Kênh kết nối + Danh sách hội thoại + Khung chat + Hồ sơ 360), việc tất cả các cột đều có nền trắng/xám sáng khiến mắt khó phân tách ranh giới giữa vùng "Điều hướng kênh" và vùng "Nội dung chat".
- **Rủi ro chính:** Dễ bị nhạt nhòa (low contrast) nếu màn hình máy tính của nhân viên có độ tương phản thấp.

### Phương án 2: Dark-Sidebar Operational Cockpit (Lấy cảm hứng chủ đạo từ Reference A — `3.png`)
- **Cảm giác tổng thể:** Bàn điều khiển tác chiến đa kênh chuyên nghiệp. Toàn bộ cụm điều hướng bên trái (Menu + Danh sách tài khoản Zalo/FB + Nhãn màu) dùng nền tối sâu (`#0F172A`), kết hợp thanh tab các cuộc trò chuyện đang mở phía trên.
- **Ưu điểm:**
  - Độ tương phản cực kỳ ấn tượng: các chấm đỏ báo tin nhắn chưa đọc (`7`, `3`, `4`), các chấm màu nhãn phân loại (`VIP`, `Đang báo giá`, `Cần xử lý gấp`) nổi bật rực rỡ trên nền tối.
  - Nhân viên trực chat liên tục 8 tiếng/ngày định vị kênh và tài khoản cực nhanh.
- **Nhược điểm:**
  - Reference A (`3.png`) thiên về công cụ trực chat thuần túy, chưa có sẵn dải KPI quản trị ở đầu trang và thẻ Cơ hội kinh doanh (Lead/Deal Value) chi tiết như Reference B (`4.png`).
- **Rủi ro chính:** Nếu lạm dụng màu tối sang cả các trang bảng biểu kế toán/đào tạo sẽ gây cảm giác hơi nặng nề.

### Phương án 3 (KHUYẾN NGHỊ CHỌN): Hybrid "Dark Navigation Rail + High-Craft Light Workspace" (Kết hợp tinh hoa của cả `3.png` và `4.png`)
- **Cảm giác tổng thể:** Kết hợp hoàn hảo sự sắc bén của **Phương án 2** (Thanh điều hướng chính & Cột Kênh kết nối nền tối `#0B1120`–`#111827` giúp gom nhóm tài khoản Zalo OA/Zalo cá nhân/Facebook và nhãn phân loại cực rõ) với sự sáng sủa, giàu dữ liệu CRM của **Phương án 1** (Dải KPI vận hành trên đầu + Danh sách hội thoại sáng + Khung chat phân màu AI/Nhân viên + Cột phải Hồ sơ Khách hàng 360 & Thẻ Lead liên kết có thanh tiến độ).
- **Tại sao đây là lựa chọn tốt nhất cho ABM CRM:**
  1. **Giải quyết trọn vẹn bài toán Đa kênh + Đa vai trò:** Đội Tư vấn/CSKH có được cột chuyển kênh và ghi chú nội bộ màu vàng cực nhanh của `3.png`; Đội Quản lý/Leader có được dải KPI tỷ lệ chuyển đổi và thẻ Cơ hội kinh doanh (Lead Card) rõ ràng của `4.png`.
  2. **Tạo ranh giới thị giác tự nhiên:** Mắt người dùng tách biệt ngay lập tức *Bên trái màu tối = Chọn nơi làm việc & lọc kênh* với *Bên phải màu sáng = Xử lý hội thoại & hồ sơ khách hàng*.
- **Rủi ro chính & cách kiểm soát:** Cần quy định rõ kích thước cố định của Thanh Rail (`64px`) và Cột Kênh (`236px`) để trên màn hình laptop 1366px–1440px có thể ẩn/hiện cột Kênh bằng 1 nút bấm, đảm bảo khung chat luôn rộng rãi.

*(Bản mẫu HTML tĩnh `ui-mockup-261014-inbox.html` đi kèm báo cáo này được xây dựng theo đúng **Phương án 3**).*

---

## MỤC 4. LỘ TRÌNH TRIỂN KHAI 3 GIAI ĐOẠN (PHASED ROADMAP)

### Giai đoạn 1 (Ưu tiên cao nhất — Tuần 1): Nâng cấp App Shell, Hệ thống Token & Làm mới hoàn toàn Inbox Đa Kênh
- **Mục tiêu:** Xóa bỏ khoảng trống chết bên phải màn hình, chuẩn hóa bảng màu kênh, và sửa dứt điểm trải nghiệm Inbox + Hồ sơ Lead liên kết.
- **Danh sách file cần chỉnh sửa:**
  1. [`apps/crm/src/web/styles.css`](file:///D:/TQD/CRM/apps/crm/src/web/styles.css): Cập nhật bộ biến `:root` (Token màu kênh Zalo OA, Zalo, Zalo Nhóm, Facebook, AI), bỏ giới hạn cứng `max-width: 1440px` trên `.content`, bổ sung CSS cho bố cục Inbox 4 vùng và thẻ hội thoại mới.
  2. [`apps/crm/src/web/components/icons.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/components/icons.tsx): Thêm 12 icon còn thiếu (huy hiệu kênh `zalo`, `zalo-oa`, `facebook`, `pin`, `star`, `paperclip`, `check-double`, `trend-up`, `trend-down`, `bot`, `copy`, `external-link`).
  3. [`apps/crm/src/web/components/layout.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/components/layout.tsx): Chuyển Sidebar sang giao diện Dark Rail/Sidebar có huy hiệu đếm số lượng chưa đọc; giữ cố định thanh Sub-tabs không bị mất khi vào trang con.
  4. [`apps/crm/src/web/pages/inbox.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/inbox.tsx):
     - Thêm dải KPI vận hành Inbox ở đầu trang và Cột lọc Kênh kết nối + Nhãn nhanh.
     - Nâng cấp `ConversationRow` có `<Avatar>`, huy hiệu kênh, số tin chưa đọc, và thẻ nhãn trạng thái.
     - Nâng cấp `ConversationPanel` ở cột phải: Khi `conversation.contactId` có giá trị, tự động tải và hiển thị **Thẻ Khách hàng (Contact Card)** và **Thẻ Hồ sơ Lead Liên kết (Linked Lead Card)** kèm nút mở chi tiết Lead và tạo thêm Lead.
  5. [`apps/crm/src/web/components/inbox-thread.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/components/inbox-thread.tsx): Đưa cụm chọn Người phụ trách và Công tắc chế độ (`AI / Nhân viên / Tạm dừng`) lên Header; thêm Avatar cạnh bong bóng chat, thẻ đính kèm PDF/tệp đẹp mắt, và tab chuyển đổi `Tin nhắn trả lời` / `Ghi chú nội bộ`.
  6. [`apps/crm/src/web/components/intake-card.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/components/intake-card.tsx): Sửa logic hiển thị để khi Intake đã được phân loại (`status: 'classified'`) hoặc hội thoại đã gắn `contactId`, hiển thị trạng thái đồng bộ thành công thay vì báo *"Lead chờ phân loại: Chưa có"*.
- **Độ phức tạp ước tính:** **M (Trung bình - khoảng 2 đến 3 ngày làm việc)** vì toàn bộ API lấy Contact (`api.getContact` / `api.listLeads`) đã có sẵn hoặc chỉ cần ghép nối trên giao diện mà không phải sửa cấu trúc cơ sở dữ liệu.

### Giai đoạn 2 (Tuần 2): Tái cấu trúc Quản lý Lead (Kanban + Bảng) & Hồ sơ Khách hàng 360 / Học viên
- **Mục tiêu:** Hợp nhất luồng xử lý của đội Sales B2B và Tư vấn tuyển sinh từ lúc nhận Lead đến lúc chăm sóc học viên.
- **Danh sách file cần chỉnh sửa:**
  1. [`apps/crm/src/web/pages/pipeline.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/pipeline.tsx) & [`apps/crm/src/web/pages/leads.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/leads.tsx): Gộp thanh chuyển đổi chế độ xem Kanban / Table, thêm dải KPI tổng giá trị Pipeline, làm giàu thẻ Kanban (thêm SĐT, huy hiệu kênh, nút mở chat).
  2. [`apps/crm/src/web/pages/lead-detail.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/lead-detail.tsx): Thiết kế lại cột phải thành thẻ thông tin có nút gọi/sao chép SĐT, nhúng khung xem trước cuộc trò chuyện Inbox gần nhất.
  3. [`apps/crm/src/web/pages/customers.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/customers.tsx) & [`apps/crm/src/web/pages/learners.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learners.tsx): Đưa các form tạo mới vào `<Modal>` hoặc `<Drawer>`, thêm Avatar và thanh tiến độ thời gian giữ chỗ 24h cho danh sách Học viên.
  4. [`apps/crm/src/web/pages/learner-detail.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learner-detail.tsx): Chia 548 dòng nội dung hiện tại thành 4 Tab rõ ràng (`Cơ hội & Tư vấn`, `Lớp học`, `Học phí`, `Hồ sơ & Quyền riêng tư`).
- **Độ phức tạp ước tính:** **M (Trung bình - khoảng 2 đến 3 ngày làm việc)**.

### Giai đoạn 3 (Tuần 3): Đồng bộ hóa Dashboard, Học phí, Đào tạo, Công việc & Quản trị
- **Mục tiêu:** Hoàn thiện độ sắc nét trên toàn bộ các trang vận hành hậu cần (Kế toán, Giáo vụ, Admin).
- **Danh sách file cần chỉnh sửa:**
  1. [`apps/crm/src/web/pages/dashboard.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/dashboard.tsx), [`pages/overview.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/overview.tsx), [`pages/learner-reports.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/learner-reports.tsx): Nâng cấp thẻ KPI có xu hướng và chia lưới 2–3 cột cho 11 bảng báo cáo học viên kèm thanh tỷ lệ trực quan.
  2. [`apps/crm/src/web/pages/fees.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fees.tsx), [`pages/fees-queue.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fees-queue.tsx), [`pages/fee-guide.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/fee-guide.tsx): Thêm dải KPI tài chính, đưa form tạo khoản thu/thanh toán vào Drawer, bổ sung khung VietQR ở trang hướng dẫn chuyển khoản.
  3. [`apps/crm/src/web/pages/courses.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/courses.tsx), [`pages/class-detail.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/class-detail.tsx), [`pages/session-attendance.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/session-attendance.tsx): Chuyển danh sách học viên trong lớp và màn hình điểm danh sang bảng lưới thao tác nhanh.
  4. [`apps/crm/src/web/pages/tasks.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/tasks.tsx) & [`pages/channel-accounts.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/pages/channel-accounts.tsx): Chuyển trang Công việc sang bố cục 3 cột song song (`Quá hạn | Hôm nay | Sắp tới`); gom các form thêm tài khoản kênh vào Modal.
- **Độ phức tạp ước tính:** **M (Trung bình - khoảng 2 đến 3 ngày làm việc)**.

---

### 4.2. Danh sách 7 Component dùng chung cần bổ sung vào `components/ui.tsx`
Để không phải viết lặp lại code trên 26 trang, chỉ cần bổ sung 7 component nhỏ gọn sau vào [`apps/crm/src/web/components/ui.tsx`](file:///D:/TQD/CRM/apps/crm/src/web/components/ui.tsx):
1. **`<ChannelBadge channel={...} verified={...} />`**: Tự động vẽ huy hiệu màu chuẩn cho `zalo_oa`, `zalo`, `zalo_group`, `facebook` ở cả góc Avatar lẫn dạng thẻ pill.
2. **`<Drawer open={...} title={...} onClose={...} />`**: Ngăn kéo trượt từ cạnh phải màn hình (`width: 440px`) để chứa các biểu mẫu Tạo/Sửa mà không làm mất ngữ cảnh bảng dữ liệu bên dưới.
3. **`<SegmentedControl options={...} value={...} onChange={...} />`**: Thanh công tắc gạt mượt mà dùng cho chuyển chế độ `AI / Nhân viên / Tạm dừng`, chuyển `Kanban / Bảng`, và chọn trạng thái điểm danh.
4. **`<KpiCard label={...} value={...} trend={...} icon={...} />`**: Thẻ chỉ số thế hệ mới có biểu tượng, số đếm `tabular-nums`, và huy hiệu xu hướng tăng/giảm.
5. **`<LinkedLeadCard lead={...} onOpen={...} />`**: Thẻ tóm tắt Hồ sơ Lead dùng chung ở cả cột phải Inbox, trang Chi tiết Khách hàng 360 và trang Chi tiết Học viên.
6. **`<QuickActionTile icon={...} label={...} active={...} />`**: Ô nút thao tác nhanh (Ghim, Hẹn nhắc, Chuyển giao, Hoàn tất).
7. **`<CopyableText value={...} />`**: Hiển thị SĐT, Email, Số tài khoản kèm nút sao chép 1 chạm có thông báo Toast.

---

### 4.3. Các rủi ro cần lưu ý khi triển khai
1. **Rủi ro trên màn hình nhỏ (Laptop 13.3 inch / 1366px):** Khi hiển thị đồng thời 4 cột ở màn hình Inbox (`64px` Rail + `236px` Kênh + `350px` Danh sách + `1fr` Chat + `396px` Hồ sơ 360), tổng chiều ngang các cột cố định là `1046px`, phần khung chat ở giữa sẽ chỉ còn khoảng `320px` trên màn 1366px.
   - *Cách xử lý:* Thêm breakpoint `@media (max-width: 1440px)` trong `styles.css` để tự động gập Cột Kênh (`236px`) thành thanh lọc ngang hoặc cho phép đóng/mở Cột Hồ sơ 360 bằng 1 nút bấm.
2. **Rủi ro hiệu năng khi tải Hồ sơ Lead liên kết ở cột phải Inbox:**
   - *Cách xử lý:* Chỉ gọi API lấy chi tiết Contact & danh sách Lead của **cuộc trò chuyện đang được chọn (`selected.contactId`)**, không gọi hàng loạt cho toàn bộ danh sách hội thoại bên trái.

---

## MỤC 5. TÓM TẮT BẢN MẪU TĨNH (STATIC HTML MOCKUP) ĐI KÈM

File bản mẫu đã được khởi tạo hoàn chỉnh tại:
- **Đường dẫn:** [`D:\TQD\CRM\plans\reports\ui-mockup-261014-inbox.html`](file:///D:/TQD/CRM/plans/reports/ui-mockup-261014-inbox.html)
- **Cách xem:** Mở trực tiếp file bằng bất kỳ trình duyệt nào (Chrome, Edge, Firefox). File tự chứa 100% HTML + CSS + JavaScript tương tác cơ bản, không gọi bất kỳ tài nguyên mạng bên ngoài nào.
- **Các tính năng có thể bấm thử trực tiếp trên bản mẫu:**
  1. **Tràn toàn màn hình (`100vw × 100vh`):** Xóa bỏ hoàn toàn mảng trắng thừa bên phải của ảnh `2.png`.
  2. **Cột Kênh kết nối & Nhãn phân loại bên trái:** Bấm chuyển đổi giữa `Tất cả kênh (148)`, `Zalo OA · Học viện ABM`, `TV Tuyển sinh 01`, `Nhóm Zalo Lớp học`, `Facebook Fanpage` có huy hiệu đỏ đếm tin chưa đọc.
  3. **Danh sách hội thoại giàu thông tin:** Có Avatar chữ cái đầu phối màu + Huy hiệu kênh đè ở góc dưới phải (`OA`, `ZL`, `FB`, `GR`), ngôi sao ghim ưu tiên, cảnh báo `⏱ Chờ phản hồi 12p`, và nhãn `✓ Đã gắn Lead #0842`.
  4. **Khung Chat thông minh:** Có công tắc chuyển chế độ `AI Tự động | Nhân viên tiếp quản | Tạm dừng` ngay trên Header; phân biệt rõ bong bóng tin nhắn của Khách, của `✦ Trợ lý AI ABM` (màu tím nhạt), và của Nhân viên (màu xanh nhạt kèm trích dẫn trả lời, thẻ tài liệu PDF đề cương và dấu đã xem `✓✓`).
  5. **Khung soạn thảo 2 chế độ:** Bấm chuyển qua lại giữa tab **`Tin nhắn trả lời khách`** (nền trắng) và **`Ghi chú nội bộ (Chỉ CSKH thấy)`** (tự động đổi sang nền vàng ấm để tránh gửi nhầm), kèm các nút chèn nhanh mẫu câu `/vietqr-hoc-phi`, `/lich-khai-giang`.
  6. **Cột phải Hồ sơ 360 & Thẻ Lead Liên kết (`#L-2026-0842`):** Minh họa trực quan cách giải quyết triệt để lỗi *"Lead chờ phân loại: Chưa có"* bằng cách hiển thị rõ Hồ sơ Khách hàng đã định danh (`Bà [khách A] · CEO`), Thẻ Lead đang theo đuổi (`Combo Khóa AI Lãnh đạo K19 · 35.100.000 ₫ · Bước 3/5`), Hộp AI đồng bộ thông tin bổ sung, Ghi chú nội bộ màu vàng và Dòng thời gian hoạt động gần đây.

---

Status: DONE
Summary: Đã hoàn tất kiểm toán toàn diện 100% mã nguồn giao diện CRM (`apps/crm/src/web/**`), chỉ rõ nguyên nhân gốc rễ gây trống trải/thô sơ kèm tọa độ file-dòng chính xác, đề xuất hệ thống Design Tokens + lộ trình nâng cấp 3 giai đoạn và xuất bản mẫu tương tác tĩnh tại `plans/reports/ui-mockup-261014-inbox.html`.
