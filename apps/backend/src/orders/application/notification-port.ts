import type { OrderStatus } from '@/orders/domain/order-events';

export interface MobileOrderNotification {
  readonly userId: string;
  readonly orderId: string;
  readonly branchId: string;
  readonly status: OrderStatus;
  readonly title: string;
  readonly body: string;
  readonly deepLink: string;
  readonly occurredAt: string;
}

export interface NotificationPort {
  notifyCustomerOrderStatus(notification: MobileOrderNotification): Promise<void>;
}
