import { AppLogger } from '@/logger';
import type {
  MobileOrderNotification,
  NotificationPort,
} from '@/orders/application/notification-port';

export class ConsoleCaptureNotifier implements NotificationPort {
  private readonly log = new AppLogger('mobile-push');
  private readonly sent: MobileOrderNotification[] = [];

  async notifyCustomerOrderStatus(notification: MobileOrderNotification): Promise<void> {
    this.sent.push(notification);
    this.log
      .info`[APNs/FCM] user=${notification.userId} order=${notification.orderId} status=${notification.status} (${notification.deepLink})`;
  }

  public getCapturedNotifications(): readonly MobileOrderNotification[] {
    return [
      ...this.sent,
    ];
  }

  public clear(): void {
    this.sent.length = 0;
  }
}
