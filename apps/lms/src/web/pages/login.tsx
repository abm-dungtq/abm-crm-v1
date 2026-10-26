import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiFailure, api } from '../api';

export function LoginPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation<{ usesDefaultPassword: boolean }, ApiFailure>({
    mutationFn: () => api.post('/auth/login', { email, password }),
    onSuccess: () => {
      // Drop anything cached for a previous learner on this device before showing the new account.
      client.clear();
      void navigate({ to: '/' });
    },
  });

  return (
    <div className="login-wrap">
      <form
        className="card login-card"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <div className="lp-logo" style={{ fontSize: 20 }}>
          ABM · Học tập
        </div>
        <p className="note" style={{ marginTop: 4 }}>
          Đăng nhập bằng email ABM đã gửi cho Anh/Chị.
        </p>
        {login.error && <div className="alert-danger">{login.error.message}</div>}
        <label htmlFor="em">Email</label>
        <input
          id="em"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <label htmlFor="pw">Mật khẩu</label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span className="note">Quên mật khẩu? Liên hệ Học vụ ABM qua Zalo.</span>
          <button className="btn pri" type="submit" disabled={login.isPending}>
            {login.isPending ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </div>
      </form>
    </div>
  );
}
