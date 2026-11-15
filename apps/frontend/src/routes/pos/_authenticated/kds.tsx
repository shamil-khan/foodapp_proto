import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { apiQueries } from '@/api/endpoints.generated';

export const Route = createFileRoute('/pos/_authenticated/kds')({
  component: KdsScreenPage,
});

function KdsScreenPage() {
  const { data: response } = useSuspenseQuery({
    ...apiQueries.getApiPosOrders(),
    refetchInterval: 10_000,
  });
  const orders = response.data?.orders ?? [];

  return (
    <div className='space-y-4'>
      <h1 className='text-xl font-bold'>Kitchen Display System (KDS)</h1>
      <div className='grid gap-4 sm:grid-cols-3'>
        {orders
          .filter((o) => o.latestMilestone !== 'SETTLED')
          .map((ticket) => (
            <div key={ticket.id} className='rounded-3xl border border-border bg-card p-5'>
              <div className='font-mono text-sm font-bold'>Ticket #{ticket.id.slice(0, 6)}</div>
              <div className='text-sm text-muted-foreground'>{ticket.latestMilestone}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
