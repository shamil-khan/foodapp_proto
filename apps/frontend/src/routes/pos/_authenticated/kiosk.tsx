import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/pos/_authenticated/kiosk')({
  component: SelfOrderKioskPage,
});

function SelfOrderKioskPage() {
  const { session } = Route.useRouteContext();

  return (
    <div className='mx-auto max-w-3xl space-y-4 py-8 text-center'>
      <h1 className='text-3xl font-bold'>Self-Order Kiosk</h1>
      <p className='text-muted-foreground'>Locked to Restaurant: {session.restaurantId}</p>
    </div>
  );
}
