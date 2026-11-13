import * as crypto from 'node:crypto';
import type { RequestContext } from '@/container';
import type { CatalogRepository } from '@/contexts/catalog/infrastructure/catalog-repository';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import type { EventBus } from '@/core/application/event-bus';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export interface UpdateMenuItemPriceCommand extends Command<Result<void>> {
  readonly menuItemId: string;
  readonly newBasePrice: number;
  readonly expectedRowVersion: number;
}

export class UpdateMenuItemPriceHandler
  implements CommandHandler<UpdateMenuItemPriceCommand, Result<void>>
{
  constructor(
    private readonly catalogRepo: CatalogRepository,
    private readonly eventBus: EventBus,
    private readonly request: RequestContext,
  ) {}

  async execute(cmd: UpdateMenuItemPriceCommand): Promise<Result<void>> {
    if (cmd.newBasePrice < 0) {
      return err(new DomainError('INVALID_PRICE', 'Menu item price cannot be negative.'));
    }

    const { updated, restaurantId } = await this.catalogRepo.updateItemPrice({
      menuItemId: cmd.menuItemId,
      newBasePrice: cmd.newBasePrice,
      expectedRowVersion: cmd.expectedRowVersion,
      actorId: this.request.actorId,
    });

    if (!updated || !restaurantId) {
      return err(
        new DomainError(
          'CONCURRENCY_CONFLICT',
          'Menu item was modified by another user or does not exist.',
          409,
        ),
      );
    }

    // Publish stateless integration event to rebuild MenuSnapshot & refresh Redis cache
    await this.eventBus.publish([
      {
        eventId: crypto.randomUUID(),
        aggregateId: restaurantId,
        aggregateType: 'RestaurantCatalog',
        eventType: 'RestaurantMenuUpdated',
        version: 1,
        occurredAt: new Date(),
        payload: {
          restaurantId,
          menuItemId: cmd.menuItemId,
          newBasePrice: cmd.newBasePrice,
        },
        metadata: {
          requestId: this.request.requestId,
          actorId: this.request.actorId,
          restaurantId,
        },
      },
    ]);

    return ok(undefined);
  }
}
