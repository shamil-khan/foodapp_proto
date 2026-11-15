import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  Link,
  Outlet,
} from '@tanstack/react-router';
import { PwaReloadPrompt } from '@/components/ui/pwa-reload-prompt';
import type { authStore } from '@/lib/auth-store';
import { logger } from '@/logger';

export interface RouterContext {
  queryClient: QueryClient;
  auth: typeof authStore;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: RootErrorBoundary,
});

function RootLayout() {
  return (
    <div className='min-h-dvh bg-background text-foreground pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]'>
      <Outlet />
      <PwaReloadPrompt />
    </div>
  );
}

function RootErrorBoundary({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('Unhandled route error: {message}', {
    message,
  });

  return (
    <main className='mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6'>
      <div className='rounded-3xl border border-destructive/40 bg-card p-6 space-y-3'>
        <h1 className='text-lg font-bold text-destructive'>Something went wrong</h1>
        <p className='text-sm text-muted-foreground'>{message}</p>
        <div className='flex gap-3 pt-2'>
          <button
            type='button'
            onClick={reset}
            className='rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground'>
            Try Again
          </button>
          <Link to='/' className='rounded-full border border-border px-4 py-2 text-sm font-medium'>
            Go Home
          </Link>
        </div>
      </div>
    </main>
  );
}
