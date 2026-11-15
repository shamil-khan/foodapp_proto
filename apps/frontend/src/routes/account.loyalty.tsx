import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { apiQueries } from '@/api/endpoints.generated';
import type { RedeemLoyaltyPointsBody } from '@/api/models.generated';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';

export const Route = createFileRoute('/account/loyalty')({
  loader: ({ context }) => context.queryClient.ensureQueryData(apiQueries.getApiLedgerLoyaltyMe()),
  component: CustomerLoyaltyPage,
});

function CustomerLoyaltyPage() {
  const qc = useQueryClient();
  const { data: response } = useSuspenseQuery(apiQueries.getApiLedgerLoyaltyMe());
  const totalPoints = response.data?.totalPoints ?? 0;

  const redeemMutation = useMutation({
    mutationFn: async (body: RedeemLoyaltyPointsBody) => {
      const { data } = await api.POST('/api/ledger/loyalty/redeem', {
        body,
      });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: [
          '/api/ledger/loyalty/me',
        ],
      });
    },
  });

  return (
    <main className='mx-auto max-w-lg p-6 space-y-6'>
      <h1 className='text-2xl font-bold'>Loyalty Rewards</h1>
      <div className='rounded-3xl border border-border p-6 space-y-4'>
        <p className='text-3xl font-bold'>{totalPoints} pts</p>
        <Button
          onPress={() =>
            redeemMutation.mutate({
              pointsToRedeem: 50,
            })
          }
          isDisabled={totalPoints < 50 || redeemMutation.isPending}>
          Redeem 50 Points
        </Button>
      </div>
    </main>
  );
}
