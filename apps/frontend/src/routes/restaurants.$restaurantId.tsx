import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { apiQueries } from '@/api/endpoints.generated';
import { formatPrice } from '@/lib/format';

export const Route = createFileRoute('/restaurants/$restaurantId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      apiQueries.getApiRestaurantsByRestaurantIdMenu({
        path: {
          restaurantId: params.restaurantId,
        },
      }),
    ),
  component: RestaurantMenuPage,
});

function RestaurantMenuPage() {
  const { restaurantId } = Route.useParams();
  const { data: response } = useSuspenseQuery(
    apiQueries.getApiRestaurantsByRestaurantIdMenu({
      path: {
        restaurantId,
      },
    }),
  );
  const menu = response.data;

  if (!menu) {
    return null;
  }

  return (
    <main className='mx-auto max-w-4xl p-6 space-y-6'>
      <header className='space-y-1'>
        <h1 className='text-2xl font-bold'>{menu.restaurantName}</h1>
        <p className='text-sm text-muted-foreground'>{menu.postcodeSector}</p>
      </header>

      {menu.categories.map((category) => (
        <section key={category.id} className='space-y-3'>
          <h2 className='text-lg font-semibold'>{category.name}</h2>
          <div className='grid gap-3 sm:grid-cols-2'>
            {category.items.map((item) => (
              <div key={item.id} className='rounded-3xl border border-border p-4 space-y-1'>
                <div className='flex items-center justify-between'>
                  <span className='font-medium'>{item.name}</span>
                  <span className='text-sm font-semibold'>{formatPrice(item.basePrice)}</span>
                </div>
                {item.description && (
                  <p className='text-xs text-muted-foreground'>{item.description}</p>
                )}
                {item.allergenFlags.length > 0 && (
                  <p className='text-xs text-muted-foreground'>
                    Allergens: {item.allergenFlags.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
