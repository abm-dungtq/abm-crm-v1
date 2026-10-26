# Lark: trả lời, thread, topic, nhóm phòng ban, tạo việc từ tin nhắn

Ngày: 26/10/2026. Nguồn chính: Lark Help Center (larksuite.com/hc), Lark Open Platform (open.larksuite.com), Feishu Help Center. Toàn bộ trích dẫn lấy trực tiếp từ bài gốc.

## Kết luận nhanh

- Lark có **2 cách trả lời** trong nhóm thường: **Reply** (trích dẫn, nằm ngay trong luồng chat chính) và **Reply in Thread** (mở một "luồng con" ở khung bên phải, không làm phiền cả nhóm).
- Thread hiện ngay dưới tin gốc, tối đa **5 câu trả lời mới nhất**. Ai trả lời thread thì **tự động theo dõi (Subscribe)**. Có thể **Unsubscribe** hoặc **Mute notifications**. Khi trả lời thread có ô **"Also send to the group"** để đẩy câu đó ra chat chính cho cả nhóm thấy.
- **Topic group** là nhóm mà mọi tin đều phải là một topic (giống diễn đàn). Chủ nhóm hoặc quản trị nhóm có thể **chuyển qua lại giữa Chat và Topic** (từ bản 6.10).
- **Department group**: nhóm gắn với phòng ban trong sơ đồ tổ chức, người vào phòng thì tự vào nhóm, người rời phòng thì tự bị gỡ. Lark **không có nhóm cha/con**. Phòng ban có cấp bậc, còn nhóm chat thì đứng riêng lẻ. Để sắp xếp danh sách chat, mỗi người tự dùng **Labels** (nhãn riêng, chỉ mình thấy), **Filters** và **Flag**.
- **Add Task** từ tin nhắn: tạo việc từ 1 hoặc nhiều tin, việc có liên kết **"Created in chat"** để quay lại đoạn chat gốc. Khi tạo việc ngay trong chat có ô **"Send task to chat"** để gửi thẻ việc vào nhóm.
- AI (Feishu 智能伙伴/MyAI): có nút **"总结最近消息"** (tóm tắt tin gần đây) trong nhóm thường. Tính năng này **không hỗ trợ topic group**, và **không thấy tài liệu nào nói AI tự rút việc cần làm từ chat**. Việc tự rút ra việc cần làm (action items) chỉ có ở biên bản họp.

## 1. Reply và Reply in Thread trong nhóm thường

**Reply (trả lời trích dẫn)**
- Câu trả lời nằm trong luồng chat chính. Khi dùng trong nhóm, Lark tự thêm @tên người gửi tin gốc vào ô soạn tin.
- Có thể chọn **một phần chữ** trong tin để trả lời, phần đó hiện phía trên câu trả lời. Tính năng này không có trong thread và topic group.
- Dưới tin gốc hiện "[số] replies". Bấm vào thì xem tất cả câu trả lời theo thứ tự thời gian **ở khung bên phải**.
- Câu trả lời đang soạn dở được lưu lại, có chấm đỏ ở nút Reply.

**Reply in Thread (trả lời trong luồng con)**
- Di chuột lên tin rồi bấm **Reply in Thread**. Khung **Thread** mở ra (khung bên phải trên máy tính). Gửi câu trả lời đầu tiên là thread được tạo.
- Mục đích, theo Lark: các câu trả lời nằm gọn bên dưới tin gốc, tách khỏi chat chính, *"prevents irrelevant notifications for uninvolved group members"* (người không liên quan không bị báo).
- **Trong chat chính**: *"If a message already has thread replies, they will appear below the message"* (cần bản 6.10 trở lên). Thẻ thread hiện tối đa **5 câu trả lời mới nhất**, kèm nút *"View earlier [number] replies"*. Bài viết **không nói** thẻ có hiện ảnh đại diện người tham gia hay không.
- Bấm vào tin thread hoặc nút **Reply** dưới tin thì mở **thread details pane** để trả lời.
- **"Also send to the group"** (trong chat 1-1 là "Also send to the chat"): câu trả lời hiện ở **cả thread lẫn chat chính**, và *"all group members will receive a notification"*.
- Không gửi được file hoặc thư mục từ máy trong thread, chỉ gửi được link Docs hoặc file đã tải lên Lark.
- Có thể **Forward thread**. Người nhận thấy một **thread card**, bấm vào để xem cả thread.
- **Theo dõi và thông báo**: bấm **Subscribe** ở góc phải khung thread để nhận báo khi có cập nhật. *"When you reply to a thread, you will automatically be subscribed to it."* Muốn tắt thì bấm **Unsubscribe** hoặc **Mute notifications**.
- Bộ lọc **"Threads & Topics"** trong Messenger gom tất cả thread và topic của mình vào một chỗ.
- Một thread có thể có trong cả chat 1-1 lẫn chat nhóm. Gửi tin trong thread không cản việc gửi tin thường trong chat.

**Chưa có trong tài liệu chính thức**: người viết tin gốc và người bị @mention trong thread **thường** có tự theo dõi hay không. Bài chỉ khẳng định người trả lời thì tự theo dõi. Ở topic mode thì có ghi rõ (xem mục 2).

## 2. Topic group (群聊话题模式)

- *"A topic group is a specialized type of group where all messages must be posted in a thread format."* Thành viên bấm **New topic**, người khác trả lời trong topic đó. Cách dùng giống diễn đàn.
- Các thao tác với một topic: **Reply, Forward, Subscribe, Edit Topic, Close Topic/Reopen Topic**. Người đăng được đóng topic của mình, chủ nhóm đóng được mọi topic. Topic đã đóng vẫn xem được nhưng không trả lời thêm được.
- Tab **Subscribed** trong nhóm gom các topic mà mình: được @mention, đã tạo, đã đăng ký theo dõi, hoặc đã trả lời.
- Thông báo: chỉ nhận báo từ topic mình theo dõi. *"Creating or replying to a topic in the group will automatically subscribe you to that topic."*
- Khác nhóm thường ở mấy điểm: nhóm thường thì chat là chính, thread là tùy chọn. Topic group thì **bắt buộc** mọi tin là topic. Topic group không có tab tự sinh (Docs, Files, Pins) và không trả lời được một phần tin.
- **Đổi chế độ**: chủ nhóm hoặc quản trị nhóm vào ··· > Settings > Group Settings > **Message type**, chọn Chat hoặc Topic. Tin cũ giữ nguyên dạng cũ, chỉ tin mới theo chế độ mới. Cần bản 6.10. Supergroup thì không đổi được.
- Bài "Create a group chat" ghi nhóm Chat thì *"chat messages can be converted into topics"* (tin chat có thể chuyển thành topic).

## 3. Lark tổ chức nhóm chat cho công ty thế nào

- **Department group**: Admin bật "Create department group" khi tạo phòng ban, chọn tên nhóm, chủ nhóm và loại nhân sự được tự vào nhóm (ví dụ chỉ nhân viên chính thức). Ai vào phòng thì tự vào nhóm, ai không còn đúng điều kiện thì tự bị gỡ. Trưởng phòng cũng tự tạo được. Thành viên thường tạo nhóm "theo phòng ban" thì chỉ ra **nhóm thường**, không có nhãn "Department".
  - Mỗi phòng ban chỉ thuộc **1** department group. Trưởng phòng chọn được phòng mình quản lý **và các phòng con**, gộp vào một nhóm.
  - Có thể mời thêm người ngoài phòng vào tay. Nhưng khi Admin bấm "Update group members" thì những người ngoài phòng đó bị gỡ ra.
  - Khi xoá phòng ban, Admin chọn giải tán nhóm hoặc chuyển thành nhóm thường để giữ lại lịch sử chat.
  - Ngoài ra có **all-staff group** (nhóm toàn công ty). Người mới vào qua link mời thì tự vào nhóm này.
- **Supergroup**: nhóm trên 5.000 người, tối đa 50.000 (nếu là topic group thì tối đa 20.000). Chỉ có ở gói Enterprise, mỗi công ty tối đa 5 nhóm, và không quay lại nhóm thường được. Supergroup **không có** Tasks, Reply in Thread, chuyển sang Topic, hay danh sách đã đọc/chưa đọc.
- **Chia nhỏ đội**: chỉ là **tạo nhóm riêng**. Lark **không có quan hệ nhóm cha/con**. Cấp bậc chỉ có ở sơ đồ phòng ban (tối đa 25 cấp).
- **Sắp xếp danh sách chat**:
  - **Labels**: nhãn riêng, *chỉ mình thấy*. Một chat gắn được nhiều nhãn, mỗi nhãn có tối đa 10 quy tắc tự gắn, chỉnh được thông báo theo nhãn.
  - **Filters**: bộ lọc có sẵn như chat riêng, nhóm, @mentions, chưa đọc, đã tắt báo, Threads & Topics. Không tự tạo bộ lọc mới được.
  - **Flag**: đánh dấu chat hoặc tin quan trọng.
  - Không tìm thấy loại "danh mục nhóm" chung do công ty đặt. Trong API, `chat_tag` (inner/tenant/department/meeting...) chỉ là loại nhóm do hệ thống gắn.

## 4. Tạo việc từ tin nhắn

- **Add Task từ tin nhắn**: bấm ··· cạnh tin > **Add Task**. Muốn gom nhiều tin thì chọn **Multiselect**, chọn các tin rồi bấm Add Task. Tạo được từ tin chữ, tin thoại, thẻ sự kiện, thẻ tin, bình chọn. Trong topic group thì bấm ··· trên topic > Add Task.
- **Việc được điền sẵn những gì**: Lark chỉ ghi rõ có liên kết **"Created in chat"** để bấm quay lại đoạn chat gốc, và việc hiện trong **danh sách việc của chat** (chat task list). Bài viết **không nói rõ** tiêu đề có lấy từ nội dung tin hay không. Với Mail thì có ghi rõ phần chữ được chọn trở thành tên việc. Người làm (owner) mặc định là người tạo, có thể thêm người làm khác và **Subscribers** (người theo dõi, được báo khi việc xong).
- **Thẻ việc trong chat**: khi tạo việc qua nút "+ More > Tasks" trong chat, có ô **"Send task to chat"** (gửi thẻ việc vào nhóm). Khi tạo qua danh sách việc của chat thì nút là **"Create and Send"**, việc *luôn* được gửi vào chat. Với Add Task từ tin nhắn, tài liệu **không nói** có gửi thẻ vào chat hay vào thread không.
- **AI**: Feishu 智能伙伴 (MyAI) trong nhóm có nút **"总结最近消息"** (tóm tắt chủ đề và kết luận gần đây), và trả lời được câu hỏi về nội dung nhóm. Chỉ dùng được ở nhóm nội bộ, không bật chế độ bảo mật, **không hỗ trợ topic group và nhóm ngoài**. Việc tự rút ra việc cần làm (待办) chỉ có ở **biên bản họp AI** và **tài liệu Docs**, không thấy có cho chat hay thread.

## 5. Gợi ý cấu trúc dữ liệu (Open API im/v1 message)

| Trường | Ý nghĩa (theo tài liệu) |
|---|---|
| `message_id` | ID tin, dạng `om_...` |
| `parent_id` | ID tin **được trả lời trực tiếp** |
| `root_id` | ID tin **gốc** của chuỗi trả lời |
| `thread_id` | ID thread mà tin thuộc về. *Không có trường này nghĩa là tin không nằm trong thread.* Theo tài liệu Lark CLI, dạng `omt_...` |
| `upper_message_id` | Chỉ dùng cho tin **chuyển tiếp gộp** (merged forward): ID của tin cha. **Không liên quan đến trả lời** |

- Trả lời thường (Reply): tin có `parent_id` và `root_id`, **không có** `thread_id`.
- Trả lời trong thread: tin có `thread_id`. API reply có tham số `reply_in_thread` (mặc định `false`). Nếu tin được trả lời đã nằm trong thread thì mặc định trả lời vào thread đó.
- Trong topic group, mọi câu trả lời đều trỏ về tin gốc, nên `root_id` = `parent_id` = tin gốc.
- Lấy lịch sử chat chính (`container_id_type=chat`) thì với thread trong nhóm thường chỉ thấy **tin gốc**. Muốn lấy các câu trả lời phải gọi `container_id_type=thread`.
- Khi tạo nhóm có `group_message_type`: `chat` (mặc định) hoặc `thread` (topic group).

## Gợi ý áp dụng cho chat trong CRM (xếp theo mức nên làm)

1. **Nên làm**: copy mô hình của nhóm thường: Reply trích dẫn, Reply in Thread mở khung bên phải, thẻ thread dưới tin gốc hiện số câu trả lời và vài câu mới nhất, ô "Cũng gửi vào nhóm", tự theo dõi khi trả lời hoặc bị @mention, có nút Theo dõi/Tắt báo. Dữ liệu dùng `parent_id` + `thread_id` (là ID tin gốc) là đủ. Không cần `upper_message_id`.
2. **Nên làm**: "Tạo việc từ tin nhắn": tiêu đề lấy sẵn từ nội dung tin (cho sửa), có liên kết quay về tin gốc, tuỳ chọn gửi thẻ việc vào nhóm hoặc thread. Phần gửi thẻ vào thread là mình thêm, Lark không ghi rõ.
3. **Có thể làm sau**: thêm một cờ chế độ nhóm `chat`/`topic`. Lark có, nhưng với đội nhỏ thì nhóm thường kèm thread đã đủ.
4. **Không nên**: làm nhóm cha/con. Lark không có. Chỉ cần nhóm phòng ban tự đồng bộ thành viên, cộng với nhóm riêng lẻ.

## Giới hạn của nghiên cứu

- Không mở được ứng dụng Lark để xem tận mắt. Thông tin lấy từ bài hướng dẫn, nên giao diện bản mới có thể khác.
- Chưa xác nhận: thẻ thread có hiện ảnh người tham gia không; người viết tin gốc và người bị @mention trong thread **thường** có tự theo dõi không; Add Task từ tin có tự lấy tiêu đề và có gửi thẻ vào chat không.
- Phần AI chỉ có tài liệu chính thức của Feishu (bản Trung Quốc). Lark quốc tế có thể khác hoặc phải trả thêm phí.

## Nguồn

- Reply to messages in a thread: https://www.larksuite.com/hc/en-US/articles/622032823229-reply-to-messages-in-a-thread
- Reply to messages: https://www.larksuite.com/hc/en-US/articles/360024163914-reply-to-messages
- Use topic groups: https://www.larksuite.com/hc/en-US/articles/360048488102-use-topic-groups
- Switch message type in a group: https://www.larksuite.com/hc/en-US/articles/561284838680-switch-message-type-in-a-group
- Create a group chat: https://www.larksuite.com/hc/en-US/articles/360024343993-create-a-group-chat
- Create department groups: https://www.larksuite.com/hc/en-US/articles/689186017723-create-department-groups
- Admin, create departments and department groups: https://www.larksuite.com/hc/en-US/articles/360047102813
- Admin, create a supergroup: https://www.larksuite.com/hc/en-US/articles/360048488292-admin-create-a-supergroup
- Label chats: https://www.larksuite.com/hc/en-US/articles/360048488208-label-chats
- Use filters in Messenger: https://www.larksuite.com/hc/en-US/articles/721047609628-use-filters-in-messenger
- Use tabs in chats: https://www.larksuite.com/hc/en-US/articles/650725303235-use-tabs-in-chats
- Create tasks: https://www.larksuite.com/hc/en-US/articles/360048488198-create-tasks
- 飞书智能伙伴使用说明书: https://www.feishu.cn/hc/zh-CN/articles/318505042260
- Message resource (Open API): https://open.larksuite.com/document/server-docs/im-v1/message/intro
- Reply message API: https://open.larksuite.com/document/server-docs/im-v1/message/reply
- Get chat history API: https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/list
- Create chat API: https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat/create
