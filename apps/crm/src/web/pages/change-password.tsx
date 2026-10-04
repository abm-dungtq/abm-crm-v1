import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { PASSWORD_MIN_LENGTH } from '@abm/contracts';
import { ApiFailure, api } from '../api';
import { Alert, Field, fieldErrors, useToast } from '../components/ui';

/** `forced` while a temporary password is in force: the page stands alone, outside the app shell. */
export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [localError, setLocalError] = useState<string | null>(null);
  const change = useMutation<null, ApiFailure>({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: form.current, newPassword: form.next }),
    onSuccess: async () => {
      toast('Đã đổi mật khẩu');
      await client.invalidateQueries();
      void navigate({ to: '/' });
    },
  });
  const errors = fieldErrors(change.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const submit = () => {
    if (form.next.length < PASSWORD_MIN_LENGTH) return setLocalError(`Mật khẩu mới cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự`);
    if (form.next !== form.repeat) return setLocalError('Hai ô mật khẩu mới chưa khớp');
    setLocalError(null);
    change.mutate();
  };

  const body = (
    <form className="card" style={{ maxWidth: 460, width: '100%' }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="card-body stack">
        <div>
          <h1>Đổi mật khẩu</h1>
          <p className="text-2" style={{ marginTop: 4 }}>
            {forced ? 'Bạn đang dùng mật khẩu tạm. Đặt mật khẩu riêng để tiếp tục.' : 'Các thiết bị khác sẽ bị đăng xuất sau khi đổi.'}
          </p>
        </div>
        {localError && <Alert tone="danger">{localError}</Alert>}
        {change.error && !Object.keys(errors).length && <Alert tone="danger">{change.error.message}</Alert>}
        <Field label={forced ? 'Mật khẩu tạm' : 'Mật khẩu hiện tại'} required error={errors.currentPassword} htmlFor="pw-current">
          <input id="pw-current" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required autoFocus />
        </Field>
        <Field label="Mật khẩu mới" required error={errors.newPassword} hint={`Ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`} htmlFor="pw-next">
          <input id="pw-next" type="password" autoComplete="new-password" value={form.next} onChange={set('next')} required minLength={PASSWORD_MIN_LENGTH} />
        </Field>
        <Field label="Nhập lại mật khẩu mới" required htmlFor="pw-repeat">
          <input id="pw-repeat" type="password" autoComplete="new-password" value={form.repeat} onChange={set('repeat')} required />
        </Field>
        <div className="row-wrap">
          <button className="btn btn-primary" type="submit" disabled={change.isPending}>{change.isPending ? 'Đang lưu…' : 'Đổi mật khẩu'}</button>
          {forced && <LogoutButton />}
        </div>
      </div>
    </form>
  );
  return forced ? <div className="picker">{body}</div> : body;
}

export function LogoutButton({ className = 'btn' }: { className?: string }) {
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => { client.clear(); window.location.assign('/'); },
  });
  return <button type="button" className={className} onClick={() => logout.mutate()} disabled={logout.isPending}>Đăng xuất</button>;
}
