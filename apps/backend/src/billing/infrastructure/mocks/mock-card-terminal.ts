import * as crypto from 'node:crypto';
import type Decimal from 'decimal.js';
import type { CardTerminalPort } from '@/billing/application/payment-gateway-port';

export class MockCardTerminalAdapter implements CardTerminalPort {
  async recordTerminalTap(params: {
    readonly terminalId: string;
    readonly orderId: string;
    readonly amountGbp: Decimal;
    readonly authCode?: string;
  }): Promise<{
    readonly approved: boolean;
    readonly terminalTxRef: string;
  }> {
    if (params.authCode === 'DECLINE') {
      return {
        approved: false,
        terminalTxRef: '',
      };
    }
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    return {
      approved: true,
      terminalTxRef: `UKPDQ-${params.terminalId}-${suffix}`,
    };
  }
}
