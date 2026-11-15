import { createFileRoute, redirect } from '@tanstack/react-router';
import { TerminalMode } from '@/lib/auth-store';

export const Route = createFileRoute('/pos/_authenticated/')({
  beforeLoad: ({ context }) => {
    const lock = context.auth.getTerminalLock();

    if (lock?.mode === TerminalMode.KDS) {
      throw redirect({
        to: '/pos/kds',
      });
    }
    if (lock?.mode === TerminalMode.KIOSK) {
      throw redirect({
        to: '/pos/kiosk',
      });
    }
    throw redirect({
      to: '/pos/register',
    });
  },
});
