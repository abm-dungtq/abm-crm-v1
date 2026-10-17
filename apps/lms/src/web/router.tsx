import { type ReactNode } from 'react';
import {
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { ApiFailure, ToastProvider, useApi, type LearnerMe } from './api';
import { ChangePasswordPage } from './pages/change-password';
import { HomePage } from './pages/home';
import { LoginPage } from './pages/login';
import { ProgramPage } from './pages/program';

function Root() {
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

function RequireAuth({ children }: { children: (me: LearnerMe) => ReactNode }) {
  const me = useApi<LearnerMe>('/me', { retry: false });
  if (me.error instanceof ApiFailure && me.error.status === 401) {
    return <Navigate to="/dang-nhap" replace />;
  }
  if (me.isLoading) {
    return <div className="empty-state">Đang tải…</div>;
  }
  if (me.error || !me.data) {
    return (
      <div className="empty-state">
        <div className="alert-danger" style={{ display: 'inline-block' }}>
          {me.error?.message ?? 'Không thể tải thông tin tài khoản'}
        </div>
      </div>
    );
  }
  return <>{children(me.data)}</>;
}

const rootRoute = createRootRoute({
  component: Root,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dang-nhap',
  component: LoginPage,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <RequireAuth>{(me) => <HomePage me={me} />}</RequireAuth>,
});

const programRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/hoc/$programId',
  validateSearch: (search: Record<string, unknown>): { phan?: string } => ({
    phan: typeof search.phan === 'string' && search.phan ? search.phan : undefined,
  }),
  component: function ProgramRouteComponent() {
    const { programId } = programRoute.useParams();
    const { phan } = programRoute.useSearch();
    return (
      <RequireAuth>
        {(me) => <ProgramPage me={me} programId={programId} phan={phan} />}
      </RequireAuth>
    );
  },
});

const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/doi-mat-khau',
  component: () => (
    <RequireAuth>{(me) => <ChangePasswordPage me={me} />}</RequireAuth>
  ),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  homeRoute,
  programRoute,
  changePasswordRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
