import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { apiQueries } from '@/api/endpoints.generated';
import type { PlacePosOrderBody } from '@/api/models.generated';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';

export const Route = createFileRoute('/pos/_authenticated/register')({
  loader: ({ context }) => {
    const restaurantId = context.auth.getSession()?.restaurantId ?? '';
    return context.queryClient.ensureQueryData(
      apiQueries.getApiRestaurantsByRestaurantIdMenu({
        path: {
          restaurantId,
        },
      }),
    );
  },
  component: PosRegisterPage,
});

function PosRegisterPage() {
  const { session } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: response } = useSuspenseQuery(
    apiQueries.getApiRestaurantsByRestaurantIdMenu({
      path: {
        restaurantId: session.restaurantId ?? '',
      },
    }),
  );
  const menu = response.data;

  const placeOrderMutation = useMutation({
    mutationFn: async (menuItemId: string) => {
      const body: PlacePosOrderBody = {
        clientOrderId: crypto.randomUUID(),
        orderSource: 'DINE_IN',
        items: [
          {
            menuItemId,
            quantity: 1,
            modifierIds: [],
          },
        ],
      };
      const { data } = await api.POST('/api/pos/orders', {
        body,
      });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: [
          '/api/pos/orders',
        ],
      });
    },
  });

  if (!menu) {
    return null;
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <h1 className='text-xl font-bold'>{menu.restaurantName} — POS Register</h1>
        {placeOrderMutation.isSuccess && placeOrderMutation.data && (
          <span className='text-sm font-medium text-primary'>
            Order #{placeOrderMutation.data.orderId.slice(0, 8)} sent to kitchen
          </span>
        )}
      </div>

      {menu.categories.map((cat) => (
        <section key={cat.id} className='space-y-3'>
          <h2 className='font-semibold'>{cat.name}</h2>
          <div className='grid gap-3 sm:grid-cols-3 lg:grid-cols-4'>
            {cat.items.map((item) => (
              <Button
                key={item.id}
                variant='outline'
                className='h-auto flex-col items-start rounded-3xl p-4 text-left'
                onPress={() => placeOrderMutation.mutate(item.id)}
                isDisabled={placeOrderMutation.isPending}>
                <span className='font-semibold'>{item.name}</span>
                <span className='text-sm text-muted-foreground'>{formatPrice(item.basePrice)}</span>
              </Button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
