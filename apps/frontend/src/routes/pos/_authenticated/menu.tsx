import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import type { UpdateMenuItemPriceBody } from '@/api/models.generated';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { PosStaffRole } from '@/lib/auth-store';

export const Route = createFileRoute('/pos/_authenticated/menu')({
  beforeLoad: ({ context }) => {
    const role = context.auth.getSession()?.role;
    if (
      role !== PosStaffRole.OWNER &&
      role !== PosStaffRole.ADMIN &&
      role !== PosStaffRole.MANAGER
    ) {
      throw redirect({
        to: '/pos/register',
      });
    }
  },
  component: PosMenuAdminPage,
});

function PosMenuAdminPage() {
  const qc = useQueryClient();
  const { session } = Route.useRouteContext();

  const updatePriceMutation = useMutation({
    mutationFn: async (
      payload: {
        itemId: string;
      } & UpdateMenuItemPriceBody,
    ) => {
      const { data } = await api.PATCH('/api/restaurants/items/{itemId}/price', {
        params: {
          path: {
            itemId: payload.itemId,
          },
        },
        body: {
          newBasePrice: payload.newBasePrice,
          expectedRowVersion: payload.expectedRowVersion,
        },
      });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: [
          '/api/restaurants/{restaurantId}/menu',
          {
            path: {
              restaurantId: session.restaurantId,
            },
          },
        ],
      });
    },
  });

  return (
    <div className='space-y-4'>
      <h1 className='text-xl font-bold'>Menu Price & Stock Management</h1>
      <p className='text-sm text-muted-foreground'>
        Uses optimistic concurrency (expectedRowVersion) to prevent conflicting price edits.
      </p>
      <Button
        variant='outline'
        onPress={() =>
          updatePriceMutation.mutate({
            itemId: 'sample-item-id',
            newBasePrice: 14.5,
            expectedRowVersion: 1,
          })
        }>
        Test Optimistic Price Update
      </Button>
    </div>
  );
}
