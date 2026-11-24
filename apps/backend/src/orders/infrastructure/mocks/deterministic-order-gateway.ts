import * as crypto from 'node:crypto';
import type {
  OrderChargeOutcome,
  OrderChargeRequest,
  OrderPaymentPort,
} from '@/orders/application/payment-port';

export class DeterministicOrderGatewayAdapter implements OrderPaymentPort {
  public readonly providerName = 'deterministic-uk-order-gateway';

  async captureCharge(req: OrderChargeRequest): Promise<OrderChargeOutcome> {
    if (req.paymentToken === 'tok_decline') {
      return {
        status: 'DECLINED',
        declineCode: 'INSUFFICIENT_FUNDS',
        message: 'Card issuer declined the GBP transaction.',
      };
    }
    if (req.paymentToken === 'tok_timeout') {
      return {
        status: 'TIMEOUT',
        message: 'Upstream payment gateway timed out.',
      };
    }
    const hash = crypto
      .createHash('sha256')
      .update(`${req.orderId}:${req.idempotencyKey}`)
      .digest('hex')
      .slice(0, 16);
    return {
      status: 'CAPTURED',
      providerReference: `uk_gw_${hash}`,
    };
  }
}
