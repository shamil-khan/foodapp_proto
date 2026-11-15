import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { apiQueries } from '@/api/endpoints.generated';

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    const lock = context.auth.getTerminalLock();
    if (lock?.isLocked) {
      throw redirect({
        to: '/pos',
      });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(apiQueries.getApiRestaurants()),
  component: StorefrontDirectoryPage,
});

function StorefrontDirectoryPage() {
  const { data: response } = useSuspenseQuery(apiQueries.getApiRestaurants());
  const restaurants = response.data?.restaurants ?? [];

  return (
    <main className='mx-auto max-w-4xl p-6 space-y-6'>
      <header className='flex items-center justify-between'>
        <h1 className='text-2xl font-bold'>FoodApp Storefront</h1>
        <div className='flex gap-3'>
          <Link to='/account/loyalty' className='text-sm font-medium underline'>
            My Loyalty
          </Link>
          <Link to='/pos/login' className='text-sm text-muted-foreground underline'>
            Staff POS Login
          </Link>
        </div>
      </header>

      <div className='grid gap-4 sm:grid-cols-2'>
        {restaurants.map((restaurant) => (
          <Link
            key={restaurant.id}
            to='/restaurants/$restaurantId'
            params={{
              restaurantId: restaurant.id,
            }}
            className='rounded-3xl border border-border bg-card p-5 transition hover:bg-muted'>
            <h2 className='text-lg font-semibold'>{restaurant.name}</h2>
            <p className='text-sm text-muted-foreground'>
              {restaurant.postcodeSector} • ~{restaurant.averagePrepTimeMinutes} mins
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
