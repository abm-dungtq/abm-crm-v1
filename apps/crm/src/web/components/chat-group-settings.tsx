import { useEffect, useId, useState, type MouseEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useActor } from '../actor-context';
import { ApiFailure, api, useApi } from '../api';
import { chatLink } from '../chat-links';
import { canCreateSubgroup, canManageMembers, canSwitchMode } from '../chat-tree';
import type { ChatConversationDetail, ChatConversationMode, DirectoryUser } from '../types';
import { roleLabel } from './layout';
import { Avatar, Badge, FormError, Modal, useToast } from './ui';

const MODE_CONFIRM: Record<ChatConversationMode, string> = {
  topic: 'Chuyển sang Chủ đề: mỗi tin mới sẽ là một chủ đề, mọi người trả lời trong chủ đề. Tin cũ giữ nguyên.',
  chat: 'Chuyển về Trò chuyện: tin mới hiện trong luồng chat chung, trả lời trích dẫn hoặc theo chuỗi như trước. Chủ đề cũ giữ nguyên.',
};

/**
 * Group settings: the name (read-only for department groups), the message mode, the members and the subgroups of a
 * department group. Buttons only show what the server allows; the server re-checks every change.
 */
export function ChatGroupSettingsDialog({
  open,
  onClose,
  conversation,
  onCreateSubgroup,
}: {
  open: boolean;
  onClose: () => void;
  conversation: ChatConversationDetail;
  /** Opens the create-group dialog with this department group as the parent. */
  onCreateSubgroup: (parent: { id: string; title: string }) => void;
}) {
  const actor = useActor();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const radioName = useId();
  const isDepartmentGroup = Boolean(conversation.departmentId);
  const myMember = conversation.members.find((m) => m.id === actor.id);
  // Same rule as before for renaming: owner, director or admin; department groups follow the department name.
  const canRename =
    !isDepartmentGroup &&
    conversation.kind === 'group' &&
    (myMember?.role === 'owner' || actor.role === 'director' || actor.role === 'admin');
  const canManage = canManageMembers(conversation, actor);
  const showMode = canSwitchMode(conversation, actor);
  const showCreateSubgroup = isDepartmentGroup && canCreateSubgroup(conversation, actor);
  const membersEditable = !conversation.system;
  const directory = useApi<DirectoryUser[]>(open && canManage ? '/directory' : null);

  const [title, setTitle] = useState(conversation.title);
  const [addUserId, setAddUserId] = useState('');

  useEffect(() => {
    setTitle(conversation.title);
    setAddUserId('');
  }, [conversation.title, open]);

  const invalidateConversation = () => {
    void client.invalidateQueries({ queryKey: ['chat', 'conversation', conversation.id] });
    void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
  };

  const renameMutation = useMutation<unknown, ApiFailure, string>({
    mutationFn: (nextTitle) =>
      api.patch(`/chat/conversations/${encodeURIComponent(conversation.id)}`, { title: nextTitle }),
    onSuccess: () => {
      invalidateConversation();
      toast('Đã đổi tên nhóm');
    },
  });

  const modeMutation = useMutation<{ mode: ChatConversationMode }, ApiFailure, ChatConversationMode>({
    mutationFn: (mode) => api.patch(`/chat/conversations/${encodeURIComponent(conversation.id)}`, { mode }),
    onSuccess: (res) => {
      client.setQueryData<ChatConversationDetail>(['chat', 'conversation', conversation.id], (prev) =>
        prev ? { ...prev, mode: res.mode } : prev,
      );
      invalidateConversation();
      void client.invalidateQueries({ queryKey: ['chat', conversation.id] });
      toast(res.mode === 'topic' ? 'Nhóm đã chuyển sang chế độ Chủ đề' : 'Nhóm đã chuyển về chế độ Trò chuyện');
    },
  });

  const addMemberMutation = useMutation<unknown, ApiFailure, string>({
    mutationFn: (userId) =>
      api.post(`/chat/conversations/${encodeURIComponent(conversation.id)}/members`, { userIds: [userId] }),
    onSuccess: () => {
      setAddUserId('');
      invalidateConversation();
      toast('Đã thêm thành viên');
    },
  });

  const removeMemberMutation = useMutation<unknown, ApiFailure, string>({
    mutationFn: (userId) =>
      api.delete(`/chat/conversations/${encodeURIComponent(conversation.id)}/members/${encodeURIComponent(userId)}`),
    onSuccess: (_res, removedId) => {
      void client.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      if (removedId === actor.id) {
        onClose();
        void navigate({ to: '/chat' });
      } else {
        void client.invalidateQueries({ queryKey: ['chat', 'conversation', conversation.id] });
        toast('Đã xóa thành viên khỏi nhóm');
      }
    },
  });

  const chooseMode = (mode: ChatConversationMode) => {
    if (mode === conversation.mode || modeMutation.isPending) return;
    if (!window.confirm(MODE_CONFIRM[mode])) return;
    modeMutation.mutate(mode);
  };

  const openSubgroup = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onClose();
    void navigate({ href });
  };

  const existingIds = new Set(conversation.members.map((m) => m.id));
  const nonMembers = (directory.data ?? []).filter((u) => !existingIds.has(u.id));
  const syncNote = isDepartmentGroup
    ? 'Thành viên tự đồng bộ theo phòng ban'
    : 'Thành viên tự đồng bộ theo danh sách nhân viên';

  return (
    <Modal open={open} title="Cài đặt nhóm" onClose={onClose}>
      <div className="stack">
        <FormError
          error={renameMutation.error ?? modeMutation.error ?? addMemberMutation.error ?? removeMemberMutation.error}
        />

        <section className="chat-settings-section" aria-label="Tên nhóm">
          <div className="chat-settings-title">Tên nhóm</div>
          {canRename ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = title.trim();
                if (trimmed && trimmed !== conversation.title) {
                  renameMutation.mutate(trimmed);
                }
              }}
            >
              <input
                type="text"
                maxLength={80}
                value={title}
                aria-label="Tên nhóm"
                onChange={(e) => setTitle(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-sm btn-primary"
                disabled={!title.trim() || title.trim() === conversation.title || renameMutation.isPending}
              >
                Đổi tên
              </button>
            </form>
          ) : (
            <>
              <input type="text" value={conversation.title} aria-label="Tên nhóm" readOnly disabled />
              {isDepartmentGroup && <span className="small muted">Theo tên phòng ban</span>}
            </>
          )}
        </section>

        {showMode && (
          <section className="chat-settings-section" aria-label="Chế độ tin nhắn">
            <div className="chat-settings-title">Chế độ tin nhắn</div>
            <div className="row-wrap" role="radiogroup" aria-label="Chế độ tin nhắn" style={{ gap: 16 }}>
              {(
                [
                  ['chat', 'Trò chuyện'],
                  ['topic', 'Chủ đề'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="row chat-mode-option">
                  <input
                    type="radio"
                    name={radioName}
                    value={value}
                    checked={conversation.mode === value}
                    disabled={modeMutation.isPending}
                    onChange={() => chooseMode(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <span className="small muted">Tin cũ giữ nguyên; chỉ tin mới theo chế độ mới.</span>
          </section>
        )}

        <section className="chat-settings-section" aria-label="Thành viên">
          <div className="chat-settings-title">Thành viên ({conversation.members.length})</div>
          {conversation.system && <span className="small muted">{syncNote}</span>}

          {canManage && nonMembers.length > 0 && (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (addUserId) addMemberMutation.mutate(addUserId);
              }}
            >
              <select
                aria-label="Chọn thành viên thêm vào nhóm"
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
              >
                <option value="">— Chọn đồng nghiệp để thêm —</option>
                {nonMembers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({roleLabel(u.role)})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="btn btn-sm btn-primary"
                disabled={!addUserId || addMemberMutation.isPending}
              >
                Thêm
              </button>
            </form>
          )}

          <ul className="list">
            {conversation.members.map((m) => {
              const canRemoveThis = membersEditable && (canManage || m.id === actor.id);
              return (
                <li key={m.id} className="row" style={{ padding: '8px 4px' }}>
                  <Avatar name={m.name} />
                  <span className="truncate" style={{ flex: 1, fontWeight: 500 }}>
                    {m.name}
                  </span>
                  {m.role === 'owner' && <Badge tone="accent">Trưởng nhóm</Badge>}
                  {canRemoveThis && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={removeMemberMutation.isPending}
                      onClick={() => removeMemberMutation.mutate(m.id)}
                    >
                      {m.id === actor.id ? 'Rời nhóm' : 'Xóa'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {isDepartmentGroup && (
          <section className="chat-settings-section" aria-label="Nhóm nhỏ">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="chat-settings-title">Nhóm nhỏ ({conversation.subgroups.length})</div>
              {showCreateSubgroup && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    onClose();
                    onCreateSubgroup({ id: conversation.id, title: conversation.title });
                  }}
                >
                  Tạo nhóm nhỏ
                </button>
              )}
            </div>
            {conversation.subgroups.length === 0 ? (
              <span className="small muted">Bạn chưa ở nhóm nhỏ nào của phòng ban này.</span>
            ) : (
              <ul className="list">
                {conversation.subgroups.map((s) => {
                  const href = chatLink({ conversationId: s.id });
                  return (
                    <li key={s.id} style={{ padding: '6px 4px' }}>
                      <a href={href} className="truncate" onClick={(e) => openSubgroup(e, href)}>
                        {s.title || 'Nhóm chat'}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
