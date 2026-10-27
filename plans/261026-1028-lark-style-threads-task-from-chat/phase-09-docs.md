---
phase: 9
title: "Docs: ADR-012, Vietnamese chat user guide, GoClaw group prompt"
status: pending
priority: P2
effort: "0.5d"
dependencies: [5, 8]
---

# Phase 09: Docs

## Goal
The durable record and the user guide match what was built:
1. **ADR-012** gets a new section `### Chuỗi, chủ đề, nhóm phòng ban và tạo việc từ chat (2026-10-26)`. It records:
   - the 4 user decisions and the deviation from Lark (subgroups nested under department groups);
   - the data model (`reply_to_message_id` / `thread_root_id` / `also_in_main`, `chat_thread`, `chat_thread_follower`, `chat_conversation.parent_conversation_id/department_id/mode`, `task.source_*`, notification kind `chat_thread`);
   - the main-flow and thread unread rules;
   - the realtime event `thread.updated`;
   - that old replies became quote replies, and why;
   - the `[TASK]` block format;
   - the D1 budget figure measured in phase 02.
2. **New user guide** `docs/guides/chat-user-guide.md`, in plain Vietnamese for staff. Every term is explained the first time it appears.
3. **GoClaw doc** `docs/integrations/goclaw-inbox-agents.md` section 7 gets the new `crm-group-assistant` prompt with the `[TASK]` block. Phase 10 pastes the same prompt into GoClaw after a backup.
4. `docs/README.md` links the new guide.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Read each file before you edit it. Verify every claim against the code from phases 01–08 (file:line). If the code differs from this plan, document the code and list the difference in your report.
- Vietnamese text in short sentences. No plan ids or phase numbers in the docs.

## Files to Create / Modify
- Modify: `docs/adr/adr-012-internal-chat-in-crm.md`, `docs/integrations/goclaw-inbox-agents.md` (section 7), `docs/README.md` (the "Hướng dẫn" line)
- Create: `docs/guides/chat-user-guide.md`

## Tasks

### Task 9.1 — ADR-012
- Steps:
  1. Add the new section before `## Phương án đã xét`. It covers the points in the Goal, links the brainstorm `../../plans/reports/brainstorm-261026-1028-lark-style-threads.md` and the research report, and says the agent still never creates tasks.
  2. Under `## Phương án đã xét`, add the alternatives with one line each:
     - old replies as thread replies, rejected because they would disappear from the main flow and task comments have no threads;
     - a JSON task block, rejected as more fragile than `key: value`;
     - a separate `task_source` table, rejected because the link is 1-1;
     - flat groups only as in Lark, rejected because the user chose nesting.
  3. In the realtime bullet of `## Quyết định`, add `thread.updated` to the event list.
- Verify: `Select-String -Path docs/adr/adr-012-internal-chat-in-crm.md -Pattern 'thread_root_id','chat_thread_follower','dept:','\[TASK\]'` prints at least 4 matches.

### Task 9.2 — User guide
- Target: `docs/guides/chat-user-guide.md` (new). Sections:
  1. `Danh sách chat`: tab Tất cả / Chuỗi; Phòng ban, Nhóm, Hệ thống (Inbox) and Tin riêng; why you are automatically in your department group and cannot leave it.
  2. `Trả lời và trả lời theo chuỗi`: when to use each (a screenshot is not required; describe the buttons); "Cũng gửi vào nhóm"; jumping to the quoted message.
  3. `Theo dõi chuỗi`: who follows automatically, how to follow, unfollow and mute, and which notifications you get.
  4. `Nhóm nhỏ trong phòng ban`: who can create one, and inviting people from other departments.
  5. `Chế độ Chủ đề`: what changes, who can switch, closing and reopening a topic, old messages kept.
  6. `Tạo việc từ chat`: from one message or from a thread; what Trợ lý fills in; fixing unmatched names; creating it once; what happens when Trợ lý is offline ("Tự tạo việc"); the "Tạo từ chat" link on the task.
  7. `Trên điện thoại`: the thread opens full screen and Back closes it.
  8. `Câu hỏi thường gặp`, at least 5 Q&A, including "Vì sao tôi không thấy tin trả lời trong nhóm?" and "Vì sao tôi không nhận thông báo của chuỗi?".
- Verify: `Test-Path docs/guides/chat-user-guide.md` prints `True`, and `Select-String -Path docs/guides/chat-user-guide.md -Pattern 'Cũng gửi vào nhóm','Chủ đề','Tạo việc từ chuỗi','Tự tạo việc'` prints at least 4 matches.

### Task 9.3 — GoClaw prompt and README
- Steps:
  1. In `goclaw-inbox-agents.md` section 7, replace the `[TASK: …]` guidance with the block format from phase 05 (copy the sample exactly) and this rule: "Khi được yêu cầu tạo việc, trả đúng 1 khối [TASK]; người làm và người liên quan chỉ chọn trong danh sách thành viên được gửi kèm; không có hạn rõ ràng thì bỏ dòng due." Keep the rule that the agent never claims it created anything. Note that the legacy one-line format still works.
  2. In `docs/README.md`, add `[chat nội bộ: chuỗi, chủ đề, tạo việc](guides/chat-user-guide.md)` to the "Hướng dẫn" line.
- Verify: `Select-String -Path docs/integrations/goclaw-inbox-agents.md -Pattern '\[/TASK\]'` prints at least one match, and `Select-String -Path docs/README.md -Pattern 'chat-user-guide.md'` prints one match.

## Success criteria
- Every Verify passes. The claims match the code. The prompt text is ready to paste into GoClaw.

## Risk
- **Docs drift from the code** if a phase deviated. The executor checks against the code, and lists the differences in the report.

## Rollback
Revert the four files.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure. Never spawn `kongming`.
Report `Status: BLOCKED` to Opus with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Wait for Opus's instruction before doing anything else.
