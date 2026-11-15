import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { ActorSource, authStore, PosStaffRole } from '@/lib/auth-store';

export const Route = createFileRoute('/pos/_authenticated')({
  beforeLoad: async ({ context }) => {
    const session = context.auth.getSession();

    if (!session || session.actorSource !== ActorSource.POS_STAFF || !session.restaurantId) {
      throw redirect({
        to: '/pos/login',
      });
    }

    if (navigator.onLine) {
      try {
        await api.GET('/api/me');
      } catch {
        throw redirect({
          to: '/pos/login',
        });
      }
    }

    return {
      session,
    };
  },
  component: AuthenticatedPosLayout,
});

function AuthenticatedPosLayout() {
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  const canManage =
    session.role === PosStaffRole.OWNER ||
    session.role === PosStaffRole.ADMIN ||
    session.role === PosStaffRole.MANAGER;

  const handleEndShift = async () => {
    try {
      await api.POST('/api/pos/auth/logout');
    } finally {
      await authStore.clearSession();
      await navigate({
        to: '/pos/login',
      });
    }
  };

  const handleUnlockDevice = async () => {
    await authStore.unlockTerminal();
    await navigate({
      to: '/',
    });
  };

  return (
    <div className='flex min-h-dvh flex-col'>
      <header className='flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3'>
        <nav className='flex flex-wrap items-center gap-2'>
          <Link
            to='/pos/register'
            className='rounded-full px-3 py-1.5 text-sm font-medium hover:bg-background'>
            Register
          </Link>
          <Link
            to='/pos/orders'
            className='rounded-full px-3 py-1.5 text-sm font-medium hover:bg-background'>
            Orders
          </Link>
          <Link
            to='/pos/kds'
            className='rounded-full px-3 py-1.5 text-sm font-medium hover:bg-background'>
            KDS
          </Link>
          <Link
            to='/pos/kiosk'
            className='rounded-full px-3 py-1.5 text-sm font-medium hover:bg-background'>
            Kiosk
          </Link>
          {canManage && (
            <>
              <Link
                to='/pos/menu'
                className='rounded-full px-3 py-1.5 text-sm font-medium hover:bg-background'>
                Menu
              </Link>
              <Link
                to='/pos/ledger'
                className='rounded-full px-3 py-1.5 text-sm font-medium hover:bg-background'>
                Ledger
              </Link>
            </>
          )}
        </nav>

        <div className='flex items-center gap-2'>
          <span className='text-xs text-muted-foreground'>
            {session.email} ({session.role})
          </span>
          <Button variant='outline' size='sm' onPress={handleEndShift}>
            Lock / Switch Staff
          </Button>
          {canManage && (
            <Button variant='ghost' size='sm' onPress={handleUnlockDevice}>
              Exit Terminal Mode
            </Button>
          )}
        </div>
      </header>

      <main className='flex-1 p-4'>
        <Outlet />
      </main>
    </div>
  );
}
