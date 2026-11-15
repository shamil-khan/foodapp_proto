import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { apiQueries } from '@/api/endpoints.generated';
import type { SettlePosOrderBody } from '@/api/models.generated';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';

export const Route = createFileRoute('/pos/_authenticated/orders')({
  loader: ({ context }) => context.queryClient.ensureQueryData(apiQueries.getApiPosOrders()),
  component: PosOrdersPage,
});

function PosOrdersPage() {
  const qc = useQueryClient();
  const { data: response } = useSuspenseQuery(apiQueries.getApiPosOrders());
  const orders = response.data?.orders ?? [];

  const settleMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const body: SettlePosOrderBody = {
        paymentMethod: 'CARD_TERMINAL',
        tipAmount: 0,
      };
      const { data } = await api.POST('/api/pos/orders/{id}/settle', {
        params: {
          path: {
            id: orderId,
          },
        },
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

  return (
    <div className='space-y-4'>
      <h1 className='text-xl font-bold'>Active POS Orders</h1>
      <div className='grid gap-3 md:grid-cols-2'>
        {orders.map((order) => (
          <div
            key={order.id}
            className='flex items-center justify-between rounded-3xl border border-border p-4'>
            <div>
              <p className='font-mono text-sm'>{order.id.slice(0, 8)}</p>
              <p className='text-sm font-semibold'>
                {order.latestMilestone} — {formatPrice(order.totalAmount)}
              </p>
            </div>
            {order.latestMilestone !== 'SETTLED' && (
              <Button
                onPress={() => settleMutation.mutate(order.id)}
                isDisabled={settleMutation.isPending}>
                Settle Bill
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
