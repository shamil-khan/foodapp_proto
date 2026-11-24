import type Decimal from 'decimal.js';

export interface GatewayChargeRequest {
  readonly orderId: string;
  readonly amountGbp: Decimal;
  readonly currency: 'GBP';
  readonly paymentToken: string;
  readonly idempotencyKey: string;
}

export type GatewayChargeOutcome =
  | {
      readonly status: 'CAPTURED';
      readonly providerReference: string;
    }
  | {
      readonly status: 'DECLINED';
      readonly declineCode: string;
      readonly message: string;
    }
  | {
      readonly status: 'TIMEOUT';
      readonly message: string;
    };

export interface PaymentGatewayPort {
  readonly providerName: string;
  captureCharge(req: GatewayChargeRequest): Promise<GatewayChargeOutcome>;
  refundCharge(params: {
    readonly providerReference: string;
    readonly amountGbp: Decimal;
    readonly reason: string;
  }): Promise<{
    readonly status: 'REFUNDED' | 'FAILED';
    readonly refundReference: string;
  }>;
}

export interface CardTerminalPort {
  recordTerminalTap(params: {
    readonly terminalId: string;
    readonly orderId: string;
    readonly amountGbp: Decimal;
    readonly authCode?: string;
  }): Promise<{
    readonly approved: boolean;
    readonly terminalTxRef: string;
  }>;
}
