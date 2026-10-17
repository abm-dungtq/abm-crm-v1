import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiFailure, api, useToast, type LearnerMe } from '../api';
import { Header } from './home';

export function ChangePasswordPage({ me }: { me: LearnerMe }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const change = useMutation<Record<string, never>, ApiFailure>({
    mutationFn: () =>
      api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: async () => {
      toast('Đã đổi mật khẩu thành công');
      await client.invalidateQueries();
      void navigate({ to: '/' });
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setLocalError('Mật khẩu mới cần ít nhất 8 ký tự');
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError('Hai ô mật khẩu mới chưa khớp');
      return;
    }
    setLocalError(null);
    change.mutate();
  };

  return (
    <div>
      <Header me={me} />
      <div className="login-wrap" style={{ minHeight: 'calc(100vh - 60px)' }}>
        <form className="card login-card" onSubmit={onSubmit}>
          <h2 style={{ margin: '0 0 4px' }}>Đổi mật khẩu</h2>
          <p className="note" style={{ marginTop: 0 }}>
            Các thiết bị khác sẽ được đăng xuất sau khi đổi mật khẩu.
          </p>
          {localError && <div className="alert-danger">{localError}</div>}
          {change.error && <div className="alert-danger">{change.error.message}</div>}
          <label htmlFor="pw-cur">Mật khẩu hiện tại</label>
          <input
            id="pw-cur"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
          <label htmlFor="pw-new">Mật khẩu mới (ít nhất 8 ký tự)</label>
          <input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
          <label htmlFor="pw-confirm">Nhập lại mật khẩu mới</label>
          <input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn"
              onClick={() => void navigate({ to: '/' })}
            >
              Huỷ
            </button>
            <button type="submit" className="btn pri" disabled={change.isPending}>
              {change.isPending ? 'Đang lưu…' : 'Lưu mật khẩu mới'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
