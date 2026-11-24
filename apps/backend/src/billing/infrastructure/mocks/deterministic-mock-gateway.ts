import * as crypto from 'node:crypto';
import type Decimal from 'decimal.js';
import type {
  GatewayChargeOutcome,
  GatewayChargeRequest,
  PaymentGatewayPort,
} from '@/billing/application/payment-gateway-port';

/**
 * Deterministic prototype adapter for UK online card payments:
 * - Token 'tok_decline' -> DECLINED
 * - Token 'tok_timeout' -> TIMEOUT
 * - Any other token     -> CAPTURED with deterministic reference
 */
export class DeterministicMockGateway implements PaymentGatewayPort {
  public readonly providerName = 'deterministic-uk-gateway';

  async captureCharge(req: GatewayChargeRequest): Promise<GatewayChargeOutcome> {
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

  async refundCharge(params: {
    readonly providerReference: string;
    readonly amountGbp: Decimal;
    readonly reason: string;
  }): Promise<{
    readonly status: 'REFUNDED' | 'FAILED';
    readonly refundReference: string;
  }> {
    if (params.providerReference.includes('fail_refund')) {
      return {
        status: 'FAILED',
        refundReference: '',
      };
    }
    return {
      status: 'REFUNDED',
      refundReference: `uk_rf_${crypto.randomUUID().slice(0, 12)}`,
    };
  }
}
