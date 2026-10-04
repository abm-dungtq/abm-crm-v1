import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { ActorContext } from './actor-context';
import { ApiFailure, currentDemoUser, useApi, useAuthMode } from './api';
import { RolePicker, Shell } from './components/layout';
import { Alert, ErrorState, Loading } from './components/ui';
import type { Actor, Me } from './types';
import { AdminPage } from './pages/admin';
import { AdminUsersPage } from './pages/admin-users';
import { ChangePasswordPage } from './pages/change-password';
import { LoginPage } from './pages/login';
import { ApprovalsPage } from './pages/approvals';
import { AuditPage } from './pages/audit';
import { AccountDetailPage, CustomersPage } from './pages/customers';
import { DashboardPage } from './pages/dashboard';
import { LeadDetailPage } from './pages/lead-detail';
import { LeadNewPage } from './pages/lead-new';
import { LeadsPage } from './pages/leads';
import { OverviewPage } from './pages/overview';
import { PipelinePage } from './pages/pipeline';
import { TasksPage } from './pages/tasks';

function Root() {
  const mode = useAuthMode();
  if (mode.isLoading) return <div className="content"><Loading /></div>;
  if (mode.error || !mode.data) return <div className="content"><ErrorState error={mode.error} onRetry={() => mode.refetch()} /></div>;
  if (mode.data === 'unconfigured') return <div className="content"><Alert tone="danger">Máy chủ chưa cấu hình cách đăng nhập (AUTH_MODE). Liên hệ Admin.</Alert></div>;
  return mode.data === 'password' ? <PasswordRoot /> : <DemoRoot />;
}

function PasswordRoot() {
  const me = useApi<Me>('/me', { retry: false });
  if (me.error instanceof ApiFailure && me.error.code === 'UNAUTHENTICATED') return <LoginPage />;
  if (me.isLoading) return <div className="content"><Loading /></div>;
  if (me.error || !me.data) return <div className="content"><ErrorState error={me.error} onRetry={() => me.refetch()} /></div>;
  if (me.data.mustChangePassword) return <ChangePasswordPage forced />;
  return (
    <ActorContext.Provider value={me.data}>
      <Shell actor={me.data}><Outlet /></Shell>
    </ActorContext.Provider>
  );
}

function DemoRoot() {
  const hasUser = Boolean(currentDemoUser());
  const me = useApi<Actor>(hasUser ? '/me' : null, { retry: false });
  if (!hasUser || (me.error instanceof ApiFailure && me.error.code === 'UNAUTHENTICATED')) return <RolePicker />;
  if (me.isLoading) return <div className="content"><Loading /></div>;
  if (me.error || !me.data) return <div className="content"><ErrorState error={me.error} onRetry={() => me.refetch()} /></div>;
  return (
    <ActorContext.Provider value={me.data}>
      <Shell actor={me.data}><Outlet /></Shell>
    </ActorContext.Provider>
  );
}

const rootRoute = createRootRoute({
  component: Root,
  notFoundComponent: () => <div className="empty"><strong>Không tìm thấy trang</strong></div>,
});

type LeadsSearch = { tab?: 'active' | 'queue' | 'won' | 'lost' | 'all'; q?: string; stage?: string };
const tabs = ['active', 'queue', 'won', 'lost', 'all'] as const;

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/overview', component: OverviewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/pipeline', component: PipelinePage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/leads',
    component: LeadsPage,
    validateSearch: (s: Record<string, unknown>): LeadsSearch => ({
      tab: tabs.includes(s.tab as never) ? (s.tab as LeadsSearch['tab']) : undefined,
      q: typeof s.q === 'string' && s.q ? s.q : undefined,
      stage: typeof s.stage === 'string' && s.stage ? s.stage : undefined,
    }),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/leads/new', component: LeadNewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/leads/$leadId', component: LeadDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/customers', component: CustomersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/customers/$accountId', component: AccountDetailPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/tasks',
    component: TasksPage,
    validateSearch: (s: Record<string, unknown>): { view?: 'open' | 'completed' } => ({ view: s.view === 'completed' ? 'completed' : undefined }),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/approvals', component: ApprovalsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/audit', component: AuditPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: AdminPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/admin/users', component: AdminUsersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/account/password', component: () => <ChangePasswordPage /> }),
] as const;

export const router = createRouter({ routeTree: rootRoute.addChildren(routes), defaultPreload: 'intent', scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
