import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';

export function PwaReloadPrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  if (!offlineReady && !needRefresh) {
    return null;
  }

  return (
    <div className='fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg'>
      <div className='text-sm font-medium'>
        {offlineReady ? 'FoodApp is ready to work offline.' : 'New version of FoodApp available.'}
      </div>
      <div className='flex items-center justify-end gap-2'>
        {needRefresh && (
          <Button size='sm' onClick={() => updateServiceWorker(true)}>
            Reload & Update
          </Button>
        )}
        <Button size='sm' variant='outline' onClick={close}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
