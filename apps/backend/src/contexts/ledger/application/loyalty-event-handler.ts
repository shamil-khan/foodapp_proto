import type { LedgerRepository } from '@/contexts/ledger/infrastructure/ledger-repository';
import type { LoyaltyPointsEligibleEvent } from '@/contexts/ordering/domain/order-events';
import type { EventBus } from '@/core/application/event-bus';
import { AppLogger } from '@/logger';

export class LoyaltyPointsEventHandler {
  private readonly log = new AppLogger('loyalty-events');

  constructor(private readonly ledgerRepo: LedgerRepository) {}

  public register(eventBus: EventBus): void {
    eventBus.subscribe('LoyaltyPointsEligible', async (event) => {
      const e = event as LoyaltyPointsEligibleEvent;
      if (e.payload.pointsEarned <= 0) return;

      await this.ledgerRepo.recordLoyaltyTransaction({
        userId: e.payload.customerId,
        restaurantId: e.payload.restaurantId,
        orderId: e.aggregateId,
        txType: 'EARNED',
        pointsDelta: e.payload.pointsEarned,
        actorId: e.metadata.actorId,
      });

      this.log
        .info`Credited ${e.payload.pointsEarned} loyalty points to user ${e.payload.customerId}`;
    });
  }
}
