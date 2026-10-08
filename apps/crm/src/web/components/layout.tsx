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
  academic: 'Khóa, lớp, ghi danh', teacher: 'Lớp của tôi', accountant: 'Học phí và thu tiền',
};

/** The B2B screens only make sense for the roles that work B2B leads. */
const B2B_ROLES: RoleCode[] = ['sale', 'leader', 'head', 'director', 'admin'];
/** Admissions screens: Sale, Leader and Admin work them; BGĐ reads them. */
const LEARNER_ROLES: RoleCode[] = ['sale', 'leader', 'director', 'admin'];
/** Zalo and Fanpage conversations: every role the Worker's inbox API admits. */
const INBOX_ROLES: RoleCode[] = ['sale', 'leader', 'head', 'director', 'admin'];

/** One screen. Screens of the same kind share a sidebar entry and switch through tabs at the top of the page. */
interface NavLeaf { to: string; label: string; roles: RoleCode[]; badge?: number; badgeLabel?: string }
interface NavGroup { label: string; icon: IconName; items: NavLeaf[] }

const visible = (items: NavLeaf[], role: RoleCode) => items.filter((n) => n.roles.includes(role));

/** True when `pathname` is the screen `to` or one of its detail pages. */
const under = (pathname: string, to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

/** The most specific screen the path belongs to, so /fees/queue is not taken for /fees. */
function currentLeaf(pathname: string, leaves: NavLeaf[]) {
  return leaves.filter((n) => under(pathname, n.to)).sort((a, b) => b.to.length - a.to.length)[0];
}

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
  const seesMoney = actor.role === 'accountant' || actor.role === 'admin' || actor.role === 'director';
  const unmatched = useApi<{ id: string }[]>(seesMoney ? '/fees/payments?unallocated=1' : null);
  const unmatchedCount = unmatched.data?.length ?? 0;

  const groups: NavGroup[] = [
    { label: 'Tổng quan', icon: 'home', items: [
      { to: '/', label: 'Tổng quan', roles: B2B_ROLES },
      { to: '/overview', label: 'Toàn cảnh', roles: ['admin', 'director'] },
      { to: '/reports/learner', label: 'Báo cáo học viên', roles: ['sale', 'leader', 'director', 'admin', 'academic', 'teacher', 'accountant'] },
    ] },
    { label: 'Lead', icon: 'board', items: [
      { to: '/pipeline', label: 'Pipeline', roles: B2B_ROLES },
      { to: '/leads', label: 'Danh sách lead', roles: B2B_ROLES },
    ] },
    { label: 'Inbox', icon: 'message', items: [
      { to: '/inbox', label: 'Hội thoại', roles: INBOX_ROLES },
      { to: '/intakes', label: 'Lead chờ phân loại', roles: INBOX_ROLES },
      { to: '/zalo-groups', label: 'Nhóm Zalo', roles: INBOX_ROLES },
    ] },
    { label: 'Khách hàng', icon: 'building', items: [
      { to: '/customers', label: 'Khách hàng 360', roles: B2B_ROLES },
      { to: '/learners', label: 'Học viên', roles: LEARNER_ROLES },
      { to: '/partners', label: 'Đối tác', roles: LEARNER_ROLES },
    ] },
    { label: 'Đào tạo', icon: 'file', items: [
      { to: '/courses', label: 'Khóa & lớp', roles: ['academic', 'admin'] },
      { to: '/my-classes', label: 'Lớp của tôi', roles: ['teacher', 'academic', 'admin'] },
      { to: '/products', label: 'Sản phẩm', roles: ['academic', 'admin', 'sale', 'leader'] },
    ] },
    { label: 'Học phí', icon: 'inbox', items: [
      { to: '/fees', label: 'Học phí', roles: ['accountant', 'admin', 'director'] },
      { to: '/fees/queue', label: 'Tiền chưa khớp', roles: ['accountant', 'admin', 'director'], badge: unmatchedCount, badgeLabel: `${unmatchedCount} khoản chưa khớp` },
    ] },
    { label: actor.role === 'admin' ? 'Công việc' : 'Việc của tôi', icon: 'check', items: [
      { to: '/tasks', label: actor.role === 'admin' ? 'Công việc' : 'Việc của tôi', roles: B2B_ROLES },
    ] },
  ];
  const adminItems: NavLeaf[] = [
    { to: '/admin/users', label: 'Người dùng', roles: ['admin'] },
    { to: '/channel-accounts', label: 'Tài khoản kênh', roles: ['admin'] },
    { to: '/admin', label: 'Cấu hình', roles: ['admin'] },
    { to: '/privacy', label: 'Dữ liệu cá nhân', roles: ['admin'] },
    { to: '/audit', label: 'Nhật ký audit', roles: ['leader', 'head', 'director', 'admin'] },
  ];
  const approvalsItem: NavLeaf = { to: '/approvals', label: 'Hàng chờ duyệt', roles: B2B_ROLES, badge: pending };

  const shownGroups = groups.flatMap((g) => {
    const items = visible(g.items, actor.role);
    return items[0] ? [{ ...g, items, first: items[0] }] : [];
  });
  const shownAdmin = visible(adminItems, actor.role);
  const leaf = currentLeaf(pathname, [...shownGroups.flatMap((g) => g.items), ...shownAdmin, approvalsItem]);
  const activeGroup = shownGroups.find((g) => leaf && g.items.includes(leaf));
  const passwordMode = currentAuthMode() === 'password';

  return (
    <div className="shell">
      <aside className="sidebar" data-open={open} aria-label="Điều hướng chính">
        <div className="brand">
          <div className="brand-mark">ABM</div>
          <div><div className="brand-name">ABM CRM</div><div className="brand-sub">MVP1 · bản đánh giá</div></div>
        </div>
        <nav className="nav">
          {shownGroups.map((g) => {
            const badge = g.items.reduce((sum, n) => sum + (n.badge ?? 0), 0);
            const badgeLabel = g.items.find((n) => n.badge)?.badgeLabel;
            const active = g === activeGroup;
            return (
              <Link key={g.label} to={g.first.to as '/'} activeOptions={{ exact: true }}
                className={active ? 'is-active' : undefined} aria-current={active ? 'page' : undefined}>
                <Icon name={g.icon} />{g.label}
                {badge ? <span className="count" aria-label={badgeLabel ?? `${badge} mục cần xử lý`}>{badge}</span> : null}
              </Link>
            );
          })}
        </nav>
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
          <div className="topbar-actions">
            <Link to="/leads/new" className="btn btn-primary"><Icon name="plus" /><span className="hide-sm">Tạo lead</span></Link>
            {approvalsItem.roles.includes(actor.role) && (
              <Link to="/approvals" className={`btn btn-ghost icon-btn badge-btn${leaf === approvalsItem ? ' is-active' : ''}`}
                aria-label={pending ? `Hàng chờ duyệt, ${pending} chờ bạn duyệt` : 'Hàng chờ duyệt'} title="Hàng chờ duyệt">
                <Icon name="approve" />{pending ? <span className="count" aria-hidden="true">{pending}</span> : null}
              </Link>
            )}
            {shownAdmin.length > 0 && (
              <Dropdown label="Quản trị" active={Boolean(leaf && shownAdmin.includes(leaf))}
                trigger={<><Icon name="settings" /><span className="hide-sm">Quản trị</span></>}>
                {shownAdmin.map((n) => (
                  <Link key={n.to} to={n.to as '/'} className="menu-item" activeOptions={{ exact: true }}>{n.label}</Link>
                ))}
              </Dropdown>
            )}
            <Dropdown label={`Tài khoản ${actor.displayName}`} trigger={<Avatar name={actor.displayName} />} wide>
              <div className="menu-head"><ActorSummary actor={actor} /></div>
              {passwordMode ? (
                <>
                  <Link to="/account/password" className="menu-item">Đổi mật khẩu</Link>
                  <LogoutButton className="menu-item" />
                </>
              ) : <UserSwitcher actor={actor} />}
            </Dropdown>
          </div>
        </header>
        <main className="content" id="main">
          {activeGroup && activeGroup.items.length > 1 && leaf && pathname === leaf.to && <SectionTabs group={activeGroup} />}
          {children}
        </main>
      </div>
    </div>
  );
}

/** Switches between the screens of one sidebar group; shown on list screens, not on detail pages. */
function SectionTabs({ group }: { group: NavGroup }) {
  return (
    <nav className="section-tabs" aria-label={group.label}>
      {group.items.map((n) => (
        <Link key={n.to} to={n.to as '/'} activeOptions={{ exact: true }}>
          {n.label}
          {n.badge ? <span className="count" aria-label={n.badgeLabel}>{n.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** A button that opens a small panel of links; closes on Escape, outside click and navigation. */
function Dropdown({ label, trigger, active = false, wide = false, children }: { label: string; trigger: ReactNode; active?: boolean; wide?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="dropdown" ref={box}>
      <button ref={button} type="button" className={`btn btn-ghost dropdown-btn${active ? ' is-active' : ''}`}
        aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {trigger}
      </button>
      {open && <div className={`menu-pop${wide ? ' wide' : ''}`}>{children}</div>}
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
      <button type="button" className="menu-item" onClick={() => setOpen((v) => !v)} aria-expanded={open}><Icon name="swap" />Đổi vai trò demo</button>
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
    academic: 'Quản lý danh mục sản phẩm, khóa, lớp và ghi danh học viên.',
    teacher: 'Điểm danh các lớp được gán; chỉ thấy tên học viên.',
    accountant: 'Ghi khoản phải thu, ghi tiền vào và phân bổ học phí.',
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
            <p className="text-2" style={{ marginTop: 4 }}>Mỗi vai trò thấy phạm vi dữ liệu và thao tác khác nhau theo ma trận quyền v1. Có thể đổi vai trò bất cứ lúc nào ở nút tài khoản góc phải trên.</p>
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

