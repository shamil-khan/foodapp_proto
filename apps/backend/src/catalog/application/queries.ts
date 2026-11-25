import { type redisClient, SYSTEM_ACTORS } from '@foodapp/db';
import type { CompiledMenuSnapshot } from '@/catalog/domain/menu-snapshot-builder';
import type { CatalogRepository } from '@/catalog/infrastructure/catalog-repository';
import type { Query, QueryHandler } from '@/core/application/cqrs';

type RedisClientType = typeof redisClient;

export interface GetBranchMenuSnapshotQuery extends Query<CompiledMenuSnapshot | null> {
  readonly branchId: string;
  readonly tag?: string;
}

export class GetBranchMenuSnapshotHandler
  implements QueryHandler<GetBranchMenuSnapshotQuery, CompiledMenuSnapshot | null>
{
  private readonly catalogRepo: CatalogRepository;
  private readonly redis: RedisClientType;

  constructor(catalogRepo: CatalogRepository, redis: RedisClientType) {
    this.catalogRepo = catalogRepo;
    this.redis = redis;
  }

  async execute(query: GetBranchMenuSnapshotQuery): Promise<CompiledMenuSnapshot | null> {
    const cacheKey = `menu:snapshot:${query.branchId}`;
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }

    let snapshot: CompiledMenuSnapshot | null = null;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      snapshot = JSON.parse(cached) as CompiledMenuSnapshot;
    } else {
      snapshot = await this.catalogRepo.getPersistedSnapshot(query.branchId);
      if (!snapshot) {
        snapshot = await this.catalogRepo.rebuildAndPersistSnapshot(
          query.branchId,
          SYSTEM_ACTORS.SYSTEM_CRON,
        );
      }
      if (snapshot) {
        await this.redis.set(cacheKey, JSON.stringify(snapshot), {
          EX: 3600,
        });
      }
    }

    if (!snapshot || !query.tag?.trim()) {
      return snapshot;
    }

    const cleanTag = query.tag.trim().toLowerCase();
    const normalizedTag = cleanTag.startsWith('#') ? cleanTag : `#${cleanTag}`;
    return {
      ...snapshot,
      categories: snapshot.categories
        .map((cat) => ({
          ...cat,
          items: cat.items.filter((item) =>
            item.ingredientTags.some((t) => t.toLowerCase() === normalizedTag),
          ),
        }))
        .filter((cat) => cat.items.length > 0),
    };
  }
}
