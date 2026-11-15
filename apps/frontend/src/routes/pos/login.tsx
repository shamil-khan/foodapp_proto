import { useMutation } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { PosLoginBody } from '@/api/models.generated';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { ActorSource, authStore, TerminalMode } from '@/lib/auth-store';
import { logger } from '@/logger';

export const Route = createFileRoute('/pos/login')({
  component: PosLoginPage,
});

function PosLoginPage() {
  const navigate = useNavigate();
  const existingLock = authStore.getTerminalLock();

  const [email, setEmail] = useState('staff1.0001@pos-tenant.co.uk');
  const [password, setPassword] = useState('password123');
  const [mode, setMode] = useState<TerminalMode>(existingLock?.mode ?? TerminalMode.POS);

  const loginMutation = useMutation({
    mutationFn: async (body: PosLoginBody) => {
      const { data } = await api.POST('/api/pos/auth/login', {
        body,
      });
      if (!data) {
        throw new Error('Missing login response');
      }
      return data;
    },
    onSuccess: async (data) => {
      await authStore.setSession({
        token: data.token,
        actorSource: ActorSource.POS_STAFF,
        actorId: data.staff.staffId,
        email: data.staff.email,
        role: data.staff.role,
        restaurantId: data.staff.restaurantId,
      });

      await authStore.lockTerminal(data.staff.restaurantId, mode);
      logger.info('POS terminal locked to restaurant {restaurantId} in {mode} mode', {
        restaurantId: data.staff.restaurantId,
        mode,
      });

      await navigate({
        to: '/pos',
      });
    },
  });

  return (
    <main className='mx-auto flex min-h-dvh max-w-md flex-col justify-center p-6'>
      <div className='rounded-4xl border border-border bg-card p-8 space-y-5'>
        <h1 className='text-2xl font-bold'>POS Shift Login</h1>

        <div className='space-y-2'>
          <label className='text-sm font-medium' htmlFor='pos-email'>
            Staff Email
          </label>
          <input
            id='pos-email'
            type='email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className='w-full rounded-full border border-border bg-background px-4 py-2.5'
          />
        </div>

        <div className='space-y-2'>
          <label className='text-sm font-medium' htmlFor='pos-password'>
            Password
          </label>
          <input
            id='pos-password'
            type='password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className='w-full rounded-full border border-border bg-background px-4 py-2.5'
          />
        </div>

        <div className='space-y-2'>
          <span className='text-sm font-medium'>Terminal Station Mode</span>
          <div className='flex gap-2'>
            {(
              [
                TerminalMode.POS,
                TerminalMode.KDS,
                TerminalMode.KIOSK,
              ] as const
            ).map((item) => (
              <Button
                key={item}
                variant={mode === item ? 'default' : 'outline'}
                onPress={() => setMode(item)}>
                {item}
              </Button>
            ))}
          </div>
        </div>

        {loginMutation.isError && (
          <p className='text-sm text-destructive'>{loginMutation.error.message}</p>
        )}

        <Button
          className='w-full'
          onPress={() =>
            loginMutation.mutate({
              email,
              password,
            })
          }
          isDisabled={loginMutation.isPending}>
          {loginMutation.isPending ? 'Signing in...' : 'Start Shift & Lock Terminal'}
        </Button>
      </div>
    </main>
  );
}
