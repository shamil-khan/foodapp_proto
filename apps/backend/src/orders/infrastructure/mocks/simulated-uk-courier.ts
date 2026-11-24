import * as crypto from 'node:crypto';
import type {
  DeliveryDispatchRequest,
  DeliveryDispatchResult,
  DeliveryProviderPort,
  NormalizedDeliveryWebhook,
} from '@/orders/application/delivery-provider-port';
import type { OrderStatus } from '@/orders/domain/order-events';

const COURIER_EVENT_MAP: Record<string, OrderStatus> = {
  COURIER_PICKED_UP: 'OUT_FOR_DELIVERY',
  IN_TRANSIT: 'OUT_FOR_DELIVERY',
  DELIVERED: 'COMPLETED',
  DELIVERY_FAILED: 'CANCELLED',
};

export class SimulatedUkCourierAdapter implements DeliveryProviderPort {
  public readonly providerCode: string;

  constructor(providerCode = 'stuart') {
    this.providerCode = providerCode;
  }

  async createDeliveryJob(req: DeliveryDispatchRequest): Promise<DeliveryDispatchResult> {
    const jobId = `${this.providerCode}_job_${crypto.randomUUID().slice(0, 10)}`;
    const rawResponse: Record<string, unknown> = {
      jobId,
      provider: this.providerCode,
      orderId: req.orderId,
      pickupSector: req.branchPostcodeSector,
      dropoffSector: req.dropoffPostcodeSector,
      challenge25Required: Boolean(req.requiresAgeVerification),
      status: 'COURIER_ASSIGNED',
    };

    return {
      providerCode: this.providerCode,
      externalDeliveryId: jobId,
      trackingUrl: `https://foodapp.co.uk{this.providerCode}/${jobId}`,
      estimatedPickupMinutes: 12,
      rawResponse,
    };
  }

  async parseWebhook(
    _headers: Record<string, string | undefined>,
    rawBody: string,
  ): Promise<NormalizedDeliveryWebhook | null> {
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      const orderId = typeof parsed.orderId === 'string' ? parsed.orderId : '';
      const externalDeliveryId =
        typeof parsed.externalDeliveryId === 'string' ? parsed.externalDeliveryId : '';
      const courierEventType =
        typeof parsed.eventType === 'string' ? parsed.eventType.toUpperCase() : '';

      if (!orderId || !externalDeliveryId || !courierEventType) {
        return null;
      }

      return {
        providerCode: this.providerCode,
        externalDeliveryId,
        orderId,
        mappedOrderStatus: COURIER_EVENT_MAP[courierEventType],
        courierEventType,
        rawPayload: parsed,
      };
    } catch {
      return null;
    }
  }
}
