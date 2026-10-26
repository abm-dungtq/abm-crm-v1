import { Outlet, createRootRoute, createRoute, createRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ActorContext } from './actor-context';
import { ApiFailure, currentDemoUser, useApi, useAuthMode } from './api';
import { RolePicker, Shell } from './components/layout';
import { Alert, ErrorState, Loading, ToastProvider } from './components/ui';
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
import { LearnerDetailPage } from './pages/learner-detail';
import { LearnerAccountsPage } from './pages/learner-accounts';
import { LmsVideosPage } from './pages/lms-videos';
import { LearnerReportsPage } from './pages/learner-reports';
import { PrivacyRequestsPage } from './pages/privacy-requests';
import { LearnerNewPage } from './pages/learner-new';
import { LearnersPage } from './pages/learners';
import { ClassDetailPage } from './pages/class-detail';
import { ClassOnlinePage } from './pages/class-online';
import { CoursesPage } from './pages/courses';
import { FeeGuidePage } from './pages/fee-guide';
import { FeesLedgerPage } from './pages/fees-ledger';
import { FeesPage } from './pages/fees';
import { FeesQueuePage } from './pages/fees-queue';
import { MyClassesPage } from './pages/my-classes';
import { SessionAttendancePage } from './pages/session-attendance';
import { PartnerDetailPage } from './pages/partner-detail';
import { ProductsPage } from './pages/products';
import { PartnersPage } from './pages/partners';
import { OverviewPage } from './pages/overview';
import { PipelinePage } from './pages/pipeline';
import { TaskDetailPage } from './pages/task-detail';
import { TasksPage } from './pages/tasks';
import { ChatPage } from './pages/chat';
import { NotificationSettingsPage } from './pages/notification-settings';
import { AgentConnectPage } from './pages/agent-connect';
import { ChannelAccountsPage } from './pages/channel-accounts';
import { InboxConversationPage, InboxIndexPage, InboxPage } from './pages/inbox';
import { InboxSettingsPage } from './pages/inbox-settings';
import { IntakesPage } from './pages/intakes';
import { ZaloGroupPage, ZaloGroupsPage } from './pages/zalo-groups';

function Root() {
  const mode = useAuthMode();
  return (
    <ToastProvider>
      {mode.isLoading ? (
        <div className="content"><Loading /></div>
      ) : mode.error || !mode.data ? (
        <div className="content"><ErrorState error={mode.error} onRetry={() => mode.refetch()} /></div>
      ) : mode.data === 'unconfigured' ? (
        <div className="content"><Alert tone="danger">Máy chủ chưa cấu hình cách đăng nhập (AUTH_MODE). Liên hệ Admin.</Alert></div>
      ) : mode.data === 'password' ? (
        <PasswordRoot />
      ) : (
        <DemoRoot />
      )}
    </ToastProvider>
  );
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

function RootError({ reset }: ErrorComponentProps) {
  return <div className="content"><Alert tone="danger">Không thể hiển thị trang. Thử lại hoặc tải lại trang để tiếp tục.</Alert>
    <button className="btn" onClick={reset}>Thử lại</button>
    <button className="btn" onClick={() => window.location.reload()}>Tải lại trang</button>
  </div>;
}

const rootRoute = createRootRoute({
  component: Root,
  errorComponent: RootError,
  notFoundComponent: () => <div className="empty"><strong>Không tìm thấy trang</strong></div>,
});

type LeadsSearch = { tab?: 'active' | 'queue' | 'won' | 'lost' | 'all'; q?: string; stage?: string; department?: string; pipeline?: 'all' | 'b2b' | 'learner' };
const tabs = ['active', 'queue', 'won', 'lost', 'all'] as const;
const pipelines = ['all', 'b2b', 'learner'] as const;

const inboxRoute = createRoute({ getParentRoute: () => rootRoute, path: '/inbox', component: InboxPage });
const inboxChildren = [
  createRoute({ getParentRoute: () => inboxRoute, path: '/', component: InboxIndexPage }),
  createRoute({ getParentRoute: () => inboxRoute, path: 'settings', component: InboxSettingsPage }),
  createRoute({ getParentRoute: () => inboxRoute, path: '$conversationId', component: InboxConversationPage }),
] as const;

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
      department: typeof s.department === 'string' && s.department ? s.department : undefined,
      pipeline: pipelines.includes(s.pipeline as never) ? (s.pipeline as LeadsSearch['pipeline']) : undefined,
    }),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/leads/new', component: LeadNewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/leads/$leadId', component: LeadDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/learners', component: LearnersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/learners/new', component: LearnerNewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/learners/$contactId', component: LearnerDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/partners', component: PartnersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/partners/$id', component: PartnerDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/products', component: ProductsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/courses', component: CoursesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/classes/$classId', component: ClassDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/classes/$classId/online', component: ClassOnlinePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/my-classes', component: MyClassesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/learner-accounts', component: LearnerAccountsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/lms-videos', component: LmsVideosPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/fees', component: FeesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/fees/queue', component: FeesQueuePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/fees/ledger/$contactId', component: FeesLedgerPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/fees/guide/$chargeId', component: FeeGuidePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/sessions/$sessionId', component: SessionAttendancePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/customers', component: CustomersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/customers/$accountId', component: AccountDetailPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/tasks',
    component: TasksPage,
    validateSearch: (s: Record<string, unknown>): { view?: 'list' | 'board'; status?: 'open' | 'completed'; mine?: '1' } => ({
      view: s.view === 'board' ? 'board' : s.view === 'list' ? 'list' : undefined,
      status: s.status === 'completed' || s.view === 'completed' ? 'completed' : undefined,
      mine: s.mine === '1' ? '1' : undefined,
    }),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/tasks/$taskId', component: TaskDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/chat', component: ChatPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/chat/$conversationId', component: ChatPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings/notifications', component: NotificationSettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings/agents', component: AgentConnectPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/approvals', component: ApprovalsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/reports/learner', component: LearnerReportsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/privacy', component: PrivacyRequestsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/audit', component: AuditPage }),
  inboxRoute.addChildren(inboxChildren),
  createRoute({ getParentRoute: () => rootRoute, path: '/intakes', component: IntakesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/zalo-groups', component: ZaloGroupsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/zalo-groups/$groupId', component: ZaloGroupPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/channel-accounts', component: ChannelAccountsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: AdminPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/admin/users', component: AdminUsersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/account/password', component: () => <ChangePasswordPage /> }),
] as const;

export const router = createRouter({ routeTree: rootRoute.addChildren(routes), defaultPreload: 'intent', scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
