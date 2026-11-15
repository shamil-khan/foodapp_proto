import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { apiQueries } from '@/api/endpoints.generated';
import { PosStaffRole } from '@/lib/auth-store';

export const Route = createFileRoute('/pos/_authenticated/ledger')({
  beforeLoad: ({ context }) => {
    const role = context.auth.getSession()?.role;
    if (role !== PosStaffRole.OWNER && role !== PosStaffRole.ADMIN) {
      throw redirect({
        to: '/pos/register',
      });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(apiQueries.getApiLedgerRestaurant()),
  component: RestaurantLedgerPage,
});

function RestaurantLedgerPage() {
  const { data: response } = useSuspenseQuery(apiQueries.getApiLedgerRestaurant());

  return (
    <div className='space-y-4'>
      <h1 className='text-xl font-bold'>Double-Entry Financial Ledger</h1>
      <pre className='overflow-auto rounded-3xl border border-border bg-muted p-4 text-xs'>
        {JSON.stringify(response.data, null, 2)}
      </pre>
    </div>
  );
}
