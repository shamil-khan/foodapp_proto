import type Decimal from 'decimal.js';

export interface OrderChargeRequest {
  readonly orderId: string;
  readonly amountGbp: Decimal;
  readonly currency: 'GBP';
  readonly paymentToken: string;
  readonly idempotencyKey: string;
}

export type OrderChargeOutcome =
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

export interface OrderPaymentPort {
  readonly providerName: string;
  captureCharge(req: OrderChargeRequest): Promise<OrderChargeOutcome>;
}
