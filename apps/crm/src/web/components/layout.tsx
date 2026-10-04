import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ROLES, type RoleCode } from '@abm/contracts';
import { currentAuthMode, setDemoUser, useApi } from '../api';
import { LogoutButton } from '../pages/change-password';
import type { AccountItem, Actor, ApprovalItem, DemoUser, LeadItem } from '../types';
import { Icon, type IconName } from './icons';
import { Avatar, ErrorState, Loading, StageBadge } from './ui';

export const roleLabel = (role: string) => ROLES.find((r) => r.code === role)?.label ?? role;

export const SCOPE_LABEL: Record<RoleCode, string> = {
  sale: 'Lead của tôi', leader: 'Team + hàng chờ phòng', head: 'Toàn phòng ban', director: 'Toàn công ty', admin: 'Toàn công ty + cấu hình',
};

interface NavItem { to: string; label: string; icon: IconName; roles?: RoleCode[]; badge?: number }

export function Shell({ actor, children }: { actor: Actor; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const approvals = useApi<ApprovalItem[]>('/approvals?status=pending');
  const pending = approvals.data?.filter((a) => a.canDecide).length ?? 0;

  const nav: NavItem[] = [
    { to: '/', label: 'Tổng quan', icon: 'home' },
    { to: '/pipeline', label: 'Pipeline', icon: 'board' },
    { to: '/leads', label: 'Lead', icon: 'leads' },
    { to: '/customers', label: 'Khách hàng 360', icon: 'building' },
    { to: '/tasks', label: actor.role === 'admin' ? 'Công việc' : 'Việc của tôi', icon: 'check' },
    { to: '/approvals', label: 'Hàng chờ duyệt', icon: 'approve', badge: pending },
    { to: '/audit', label: 'Nhật ký audit', icon: 'audit', roles: ['leader', 'head', 'director', 'admin'] },
    { to: '/admin/users', label: 'Người dùng', icon: 'leads', roles: ['admin'] },
    { to: '/admin', label: 'Cấu hình', icon: 'settings', roles: ['admin'] },
  ];
  const passwordMode = currentAuthMode() === 'password';

  return (
    <div className="shell">
      <aside className="sidebar" data-open={open} aria-label="Điều hướng chính">
        <div className="brand">
          <div className="brand-mark">ABM</div>
          <div><div className="brand-name">ABM CRM</div><div className="brand-sub">MVP1 · bản đánh giá</div></div>
        </div>
        <nav className="nav">
          {nav.filter((n) => !n.roles || n.roles.includes(actor.role)).map((n) => (
            <Link key={n.to} to={n.to as '/'} activeOptions={{ exact: n.to === '/' || n.to === '/admin' }}>
              <Icon name={n.icon} />{n.label}
              {n.badge ? <span className="count" aria-label={`${n.badge} chờ bạn duyệt`}>{n.badge}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          {passwordMode ? <AccountBox actor={actor} /> : <UserSwitcher actor={actor} />}
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <div className="main">
        <div className="demo-banner">
          {passwordMode
            ? 'Bản đánh giá với dữ liệu mẫu hư cấu. Không nhập dữ liệu khách hàng thật.'
            : 'Bản đánh giá với dữ liệu mẫu hư cấu. Đăng nhập thật chưa bật; chọn vai trò để xem quyền khác nhau.'}
        </div>
        <header className="topbar">
          <button className="btn btn-ghost icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Mở menu"><Icon name="menu" /></button>
          <GlobalSearch />
          <span className="spacer hide-sm" />
          <Link to="/leads/new" className="btn btn-primary"><Icon name="plus" /><span className="hide-sm">Tạo lead</span></Link>
        </header>
        <main className="content" id="main">{children}</main>
      </div>
    </div>
  );
}

function ActorSummary({ actor }: { actor: Actor }) {
  return (
    <div className="row">
      <Avatar name={actor.displayName} size="lg" />
      <div className="truncate">
        <div className="truncate" style={{ fontWeight: 600 }}>{actor.displayName}</div>
        <div className="small muted truncate">{roleLabel(actor.role)} · {SCOPE_LABEL[actor.role]}</div>
      </div>
    </div>
  );
}

function AccountBox({ actor }: { actor: Actor }) {
  return (
    <div className="stack-sm">
      <ActorSummary actor={actor} />
      <div className="row-wrap">
        <Link to="/account/password" className="btn btn-sm">Đổi mật khẩu</Link>
        <LogoutButton className="btn btn-sm" />
      </div>
    </div>
  );
}

function UserSwitcher({ actor }: { actor: Actor }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const users = useApi<DemoUser[]>(open ? '/demo-users' : null);
  const switchTo = (id: string | null) => {
    setDemoUser(id);
    client.clear();
    window.location.assign('/');
  };
  return (
    <div className="stack-sm">
      <ActorSummary actor={actor} />
      <button className="btn btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}><Icon name="swap" />Đổi vai trò demo</button>
      {open && (
        <div className="stack-sm" style={{ maxHeight: 260, overflow: 'auto' }}>
          {users.isLoading && <Loading rows={3} />}
          {users.data?.map((u) => (
            <button key={u.id} className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} disabled={u.id === actor.id} onClick={() => switchTo(u.id)}>
              <span className="truncate">{u.name}</span><span className="muted small">· {roleLabel(u.role)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  const result = useApi<{ leads: LeadItem[]; accounts: AccountItem[] }>(debounced.length >= 2 ? `/search?q=${encodeURIComponent(debounced)}` : null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => { setQ(''); setFocused(false); }, [pathname]);
  const show = focused && debounced.length >= 2;
  return (
    <div className="search" ref={box} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setFocused(false); }}>
      <Icon name="search" />
      <label className="visually-hidden" htmlFor="global-search">Tìm lead, khách hàng, số điện thoại</label>
      <input id="global-search" type="search" placeholder="Tìm lead, khách hàng, SĐT, mã L-…" value={q}
        onChange={(e) => setQ(e.target.value)} onFocus={() => setFocused(true)} onKeyDown={(e) => e.key === 'Escape' && setFocused(false)} autoComplete="off" />
      {show && (
        <div className="search-pop" role="listbox" aria-label="Kết quả tìm kiếm">
          {result.isLoading && <div className="muted small" style={{ padding: 8 }}>Đang tìm…</div>}
          {result.data && !result.data.leads.length && !result.data.accounts.length && <div className="muted small" style={{ padding: 8 }}>Không có kết quả trong phạm vi của bạn.</div>}
          {!!result.data?.leads.length && <div className="group">Lead</div>}
          {result.data?.leads.map((l) => (
            <Link key={l.id} to="/leads/$leadId" params={{ leadId: l.id }}>
              <span className="mono muted">{l.code}</span>
              <span className="truncate" style={{ flex: 1 }}>{l.contactName}{l.account ? ` · ${l.account.name}` : ''}</span>
              <StageBadge stage={l.stage} />
            </Link>
          ))}
          {!!result.data?.accounts.length && <div className="group">Khách hàng</div>}
          {result.data?.accounts.map((a) => (
            <Link key={a.id} to="/customers/$accountId" params={{ accountId: a.id }}>
              <Icon name="building" style={{ width: 16, height: 16 }} />
              <span className="truncate" style={{ flex: 1 }}>{a.name}</span>
              <span className="muted small">{a.leadCount} lead</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function RolePicker() {
  const users = useApi<DemoUser[]>('/demo-users');
  const describe: Record<RoleCode, string> = {
    sale: 'Chỉ thấy lead mình phụ trách; ghi hoạt động, đổi stage, yêu cầu chuyển owner.',
    leader: 'Thấy team và hàng chờ phòng; giao lead, nhả lead, duyệt chuyển owner.',
    head: 'Xem toàn phòng ban, dashboard theo Sale.',
    director: 'Xem toàn công ty.',
    admin: 'Xem và cập nhật dữ liệu toàn công ty (không duyệt yêu cầu), quản lý người dùng và cấu hình.',
  };
  return (
    <div className="picker">
      <div className="card picker-card">
        <div className="card-body stack">
          <div className="brand" style={{ padding: 0 }}>
            <div className="brand-mark">ABM</div>
            <div><div className="brand-name">ABM CRM · MVP1</div><div className="brand-sub">Bản đánh giá, dữ liệu mẫu hư cấu</div></div>
          </div>
          <div>
            <h1>Chọn người dùng để đánh giá</h1>
            <p className="text-2" style={{ marginTop: 4 }}>Mỗi vai trò thấy phạm vi dữ liệu và thao tác khác nhau theo ma trận quyền v1. Có thể đổi vai trò bất cứ lúc nào ở góc trái dưới.</p>
          </div>
          {users.isLoading && <Loading rows={3} />}
          {users.error && <ErrorState error={users.error} onRetry={() => users.refetch()} />}
          <div className="role-grid">
            {users.data?.map((u) => (
              <button key={u.id} className="role-option" onClick={() => { setDemoUser(u.id); window.location.assign('/'); }}>
                <Avatar name={u.name} size="lg" />
                <span className="stack-sm" style={{ gap: 2 }}>
                  <span className="name">{u.name}</span>
                  <span className="small muted">{roleLabel(u.role)}{u.teamName ? ` · ${u.teamName}` : ''}</span>
                  <span className="small text-2">{describe[u.role]}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

