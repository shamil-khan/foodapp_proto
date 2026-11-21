import type { redisClient } from '@foodapp/db';
import type { CatalogRepository } from '@/catalog/infrastructure/catalog-repository';
import type { EventBus } from '@/core/application/event-bus';
import { AppLogger } from '@/logger';

type RedisClientType = typeof redisClient;

export class MenuCacheInvalidationHandler {
  private readonly log = new AppLogger('catalog-cache');
  private readonly catalogRepo: CatalogRepository;
  private readonly redis: RedisClientType;

  constructor(catalogRepo: CatalogRepository, redis: RedisClientType) {
    this.catalogRepo = catalogRepo;
    this.redis = redis;
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('BranchMenuUpdated', async (event) => {
      const branchId = event.aggregateId;
      const actorId = event.metadata.actorId;

      const snapshot = await this.catalogRepo.rebuildAndPersistSnapshot(branchId, actorId);
      if (snapshot) {
        const cacheKey = `menu:snapshot:${branchId}`;

        if (!this.redis.isOpen) {
          await this.redis.connect();
        }

        await this.redis.set(cacheKey, JSON.stringify(snapshot), {
          EX: 3600,
        });
        this.log
          .info`Refreshed Redis & JSONB MenuSnapshot (${snapshot.versionHash}) for branch ${branchId}`;
      }
    });
  }
}
