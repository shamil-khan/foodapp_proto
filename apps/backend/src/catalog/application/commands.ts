import * as crypto from 'node:crypto';
import type { CatalogRepository } from '@/catalog/infrastructure/catalog-repository';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
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
  private readonly catalogRepo: CatalogRepository;
  private readonly eventBus: EventBus;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    catalogRepo: CatalogRepository,
    eventBus: EventBus,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.catalogRepo = catalogRepo;
    this.eventBus = eventBus;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: UpdateMenuItemPriceCommand): Promise<Result<void>> {
    if (cmd.newBasePrice < 0) {
      return err(new DomainError('INVALID_PRICE', 'Menu item price cannot be negative.'));
    }

    const ownerRestaurantId = await this.catalogRepo.getMenuItemRestaurantId(cmd.menuItemId);
    if (!ownerRestaurantId) {
      return err(new DomainError('ITEM_NOT_FOUND', 'Menu item does not exist.', 404));
    }

    const access = this.authz.assertRestaurantAccess(ownerRestaurantId, 'catalog:price:update');
    if (!access.ok) {
      return access;
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
