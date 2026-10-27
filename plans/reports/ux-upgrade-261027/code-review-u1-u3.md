# Code review of the chat and tasks UI upgrade (runs U1–U3, uncommitted diff)

The supervisor condensed this from the code-reviewer's reply (the reviewer cannot write files). Typecheck and the full suite passed (810 passed, 2 skipped).

## High
- **H1. Catastrophic backtracking in `TRAILING_MENTIONS`** (`apps/crm/src/worker/chat-tasks.ts:50`, used by `draftTitleFrom` at :71).
  - The pattern `(?:[\s,:;–-]*TOKEN\s*)+$` lets each gap match two ways.
  - Measured in Node 24:
    - 20 mentions, then text: 937 ms.
    - Mentions separated by 3 spaces: 14 mentions took 15.3 s.
  - Any chat member can send such a message. When someone then asks for a task draft, the Worker burns CPU (the free plan allows 10 ms).
  - Fix: a linear split-and-trim loop, plus a timing test.

## Medium
- **M1. Composer drafts leak between users on a shared device** (`apps/crm/src/web/chat-links.ts`, `chatDraftKey` around :56; `components/chat-composer.tsx:193-197`).
  - The key `chat-draft:<conversationId>:<root|main>` has no user id.
  - `sessionStorage` survives the logout reload, so the next user sees the previous user's text and can send it under their own name.
- **M2. `DateTimeField` commits half-typed values** (`components/date-time-field.tsx:65-83`).
  - `handleType` calls `onChange` on every keystroke that parses.
  - Example: typing "2" over "09:00" commits 02:00. An invalid blur then reverts to 02:00, not 09:00.
- **M3. Kanban card menu ignores Escape, and two menus can be open** (`components/task-board.tsx`, the `deal-card-menu` span around :72, with `components/ui.tsx:299`).
  - `stopPropagation` (needed for dnd-kit) stops the native event, so `OverflowMenu`'s document listeners never run.
- **M4. `ConfirmDialog` loses focus on close** (`components/ui.tsx:198-243`).
  - Callers unmount the open `<dialog>`, so focus falls to `<body>`.
  - When a dialog is opened from a menu item, that item is already gone.
  - Fix: restore focus to the opener, or to the menu's "⋯" button.
- **M5. Tasks search drops keystrokes** (`pages/tasks.tsx`, the `qInput` and `search.q` effects around :56-63).
  - The URL-to-input sync overwrites newer typing.
  - Fix: a `lastPushedQ` ref, so the input syncs only for external URL changes.

## Low
- **L1.** The "Tin mới" snapshot reads `lastReadAt` from a stale cached list (`chat-thread.tsx:144-160`). Wait for the list refetch before taking the snapshot.
- **L2.** The due filter is applied to the board's "Xong" column (`task-board.tsx` around :198). Skip `due` for completed items.
- **L3.** A closed `ConfirmDialog` is mounted for every own message (`chat-message-item.tsx:421`). Render it only when open.
- **L4.** The thread panel shows "Hôm nay" twice (`chat-thread-panel.tsx:315,334`). Build the flow once over `[root, ...replies]`.
- **L5.** Keyboard and labelling gaps:
  - `OverflowMenu` has `role="menu"` but no arrow, Home or End keys.
  - The Combobox's `aria-controls` points at a listbox that does not exist while it is closed.

## Checked and fine
- No XSS: all text is rendered as plain React text, and there is no `dangerouslySetInnerHTML`.
- `listConversations` is still one query, and `buildManualTaskDraft` is one batch of two queries.
- Day grouping uses Vietnam time.
- Nested dialogs keep the parent open.
- The DateTimeField popup is not clipped.
