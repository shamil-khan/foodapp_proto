import type { OrderStatus } from '@/orders/domain/order-events';

export type DeliveryMode = 'MERCHANT_SELF_DELIVERY' | 'EXTERNAL_3PL';

export interface DeliveryDispatchRequest {
  readonly orderId: string;
  readonly branchId: string;
  readonly branchPostcodeSector: string;
  readonly dropoffPostcodeSector: string;
  readonly dropoffAddress: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly requiresAgeVerification?: boolean;
}

export interface DeliveryDispatchResult {
  readonly providerCode: string;
  readonly externalDeliveryId: string;
  readonly trackingUrl: string;
  readonly estimatedPickupMinutes: number;
  readonly rawResponse: Record<string, unknown>;
}

export interface NormalizedDeliveryWebhook {
  readonly providerCode: string;
  readonly externalDeliveryId: string;
  readonly orderId: string;
  readonly mappedOrderStatus?: OrderStatus;
  readonly courierEventType: string;
  readonly rawPayload: Record<string, unknown>;
}

export interface DeliveryProviderPort {
  readonly providerCode: string;
  createDeliveryJob(req: DeliveryDispatchRequest): Promise<DeliveryDispatchResult>;
  parseWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): Promise<NormalizedDeliveryWebhook | null>;
}
