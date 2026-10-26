import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ApiFailure } from './api';
import { router } from './router';
import './styles.css';

// An expired session on any screen sends the learner back to the login page with nothing cached.
// Login and password-change failures stay on their own forms.
const onAuthError = (error: unknown) => {
  const path = router.state.location.pathname;
  if (error instanceof ApiFailure && error.status === 401 && path !== '/dang-nhap' && path !== '/doi-mat-khau') {
    queryClient.clear();
    void router.navigate({ to: '/dang-nhap', replace: true });
  }
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, error) =>
        !(error instanceof ApiFailure && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
