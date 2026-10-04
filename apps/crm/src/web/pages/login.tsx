import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiFailure, api } from '../api';
import { Alert, Field } from '../components/ui';

export function LoginPage() {
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation<{ mustChangePassword: boolean }, ApiFailure>({
    mutationFn: () => api.post('/auth/login', { email, password }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <div className="picker">
      <form className="card picker-card" style={{ maxWidth: 420 }} onSubmit={(e) => { e.preventDefault(); login.mutate(); }}>
        <div className="card-body stack">
          <div className="brand" style={{ padding: 0 }}>
            <div className="brand-mark">ABM</div>
            <div><div className="brand-name">ABM CRM</div><div className="brand-sub">Đăng nhập bằng email công ty</div></div>
          </div>
          <h1>Đăng nhập</h1>
          {login.error && <Alert tone="danger">{login.error.message}</Alert>}
          <Field label="Email" required htmlFor="login-email">
            <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Mật khẩu" required htmlFor="login-password" hint="Lần đầu đăng nhập: dùng mật khẩu tạm Admin gửi.">
            <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn btn-primary" type="submit" disabled={login.isPending}>{login.isPending ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
          <p className="small muted">Quên mật khẩu? Liên hệ Admin để được cấp mật khẩu tạm mới.</p>
        </div>
      </form>
    </div>
  );
}
