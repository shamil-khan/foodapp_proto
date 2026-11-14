import type { redisClient } from '@foodapp/db';
import type { CatalogRepository } from '@/contexts/catalog/infrastructure/catalog-repository';
import type { EventBus } from '@/core/application/event-bus';
import { AppLogger } from '@/logger';

type RedisClientType = typeof redisClient;

export class MenuCacheInvalidationHandler {
  private readonly log = new AppLogger('catalog-cache');

  constructor(
    private readonly catalogRepo: CatalogRepository,
    private readonly redis: RedisClientType,
  ) {}

  public register(eventBus: EventBus): void {
    eventBus.subscribe('RestaurantMenuUpdated', async (event) => {
      const restaurantId = event.aggregateId;
      const actorId = event.metadata.actorId;

      const snapshot = await this.catalogRepo.rebuildAndPersistSnapshot(restaurantId, actorId);
      if (snapshot) {
        const cacheKey = `menu:snapshot:${restaurantId}`;

        if (!this.redis.isOpen) {
          await this.redis.connect();
        }

        await this.redis.set(cacheKey, JSON.stringify(snapshot), {
          EX: 3600,
        });
        this.log
          .info`Refreshed Redis & JSONB MenuSnapshot (${snapshot.versionHash}) for restaurant ${restaurantId}`;
      }
    });
  }
}
