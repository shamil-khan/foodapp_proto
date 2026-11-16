import {
  RestaurantLayoutTable,
  RestaurantTable,
  type redisClient,
  SYSTEM_ACTORS,
  sqlSelect,
} from '@foodapp/db';
import type { Pool } from 'pg';
import type { CompiledMenuSnapshot } from '@/contexts/catalog/domain/menu-snapshot-builder';
import type { CatalogRepository } from '@/contexts/catalog/infrastructure/catalog-repository';
import type { Query, QueryHandler } from '@/core/application/cqrs';

type RedisClientType = typeof redisClient;

export interface StorefrontRestaurantDto {
  id: string;
  name: string;
  subdomain: string;
  postcodeSector: string;
  foodHygieneRating: number | null;
  averagePrepTimeMinutes: number;
  branding: {
    templateId: string;
    primaryColor: string;
    bannerUrl: string | null;
  } | null;
}

export interface GetRestaurantsQuery extends Query<StorefrontRestaurantDto[]> {
  readonly postcodeSector?: string;
  readonly search?: string;
  readonly skip?: number;
  readonly take?: number;
}

export class GetRestaurantsHandler
  implements QueryHandler<GetRestaurantsQuery, StorefrontRestaurantDto[]>
{
  constructor(private readonly pool: Pool) {}

  async execute(query: GetRestaurantsQuery): Promise<StorefrontRestaurantDto[]> {
    const { cols } = RestaurantTable;

    const builder = sqlSelect(RestaurantTable)
      .select([
        cols.id,
        cols.name,
        cols.subdomain,
        cols.postcodeSector,
        cols.foodHygieneRating,
        cols.averagePrepTimeMinutes,
      ])
      .whereEq(cols.isActiveOverride, true)
      .activeOnly();

    if (query.postcodeSector?.trim()) {
      builder.whereILike(cols.postcodeSector, `${query.postcodeSector.trim().toUpperCase()}%`);
    }

    if (query.search?.trim()) {
      builder.whereILike(cols.name, `%${query.search.trim()}%`);
    }

    const restaurantsQuery = builder
      .orderBy(cols.name, 'ASC')
      .skip(query.skip ?? 0)
      .take(Math.min(query.take ?? 20, 100))
      .compile();

    const { rows: restaurants } = await this.pool.query<typeof restaurantsQuery._result>(
      restaurantsQuery.text,
      restaurantsQuery.params,
    );

    if (restaurants.length === 0) {
      return [];
    }

    const lCols = RestaurantLayoutTable.cols;
    const layoutsQuery = sqlSelect(RestaurantLayoutTable)
      .select([
        lCols.restaurantId,
        lCols.templateId,
        lCols.primaryColor,
        lCols.bannerUrl,
      ])
      .whereIn(
        lCols.restaurantId,
        restaurants.map((r) => r.id),
      )
      .activeOnly()
      .compile();

    const { rows: layouts } = await this.pool.query<typeof layoutsQuery._result>(
      layoutsQuery.text,
      layoutsQuery.params,
    );

    const layoutByRestaurant = new Map(
      layouts.map((l) => [
        l.restaurantId,
        l,
      ]),
    );

    return restaurants.map((r) => {
      const layout = layoutByRestaurant.get(r.id);
      return {
        id: r.id,
        name: r.name,
        subdomain: r.subdomain,
        postcodeSector: r.postcodeSector,
        foodHygieneRating: r.foodHygieneRating,
        averagePrepTimeMinutes: r.averagePrepTimeMinutes,
        branding: layout
          ? {
              templateId: layout.templateId,
              primaryColor: layout.primaryColor,
              bannerUrl: layout.bannerUrl,
            }
          : null,
      };
    });
  }
}
export interface GetRestaurantBySubdomainQuery extends Query<StorefrontRestaurantDto | null> {
  readonly subdomain: string;
}

export class GetRestaurantBySubdomainHandler
  implements QueryHandler<GetRestaurantBySubdomainQuery, StorefrontRestaurantDto | null>
{
  constructor(private readonly pool: Pool) {}

  async execute(query: GetRestaurantBySubdomainQuery): Promise<StorefrontRestaurantDto | null> {
    const { cols } = RestaurantTable;
    const cleanSubdomain = query.subdomain.trim().toLowerCase();

    const restQuery = sqlSelect(RestaurantTable)
      .select([
        cols.id,
        cols.name,
        cols.subdomain,
        cols.postcodeSector,
        cols.foodHygieneRating,
        cols.averagePrepTimeMinutes,
      ])
      .whereEq(cols.subdomain, cleanSubdomain)
      .whereEq(cols.isActiveOverride, true)
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof restQuery._result>(
      restQuery.text,
      restQuery.params,
    );
    const restaurant = rows[0];
    if (!restaurant) return null;

    const lCols = RestaurantLayoutTable.cols;
    const layoutQuery = sqlSelect(RestaurantLayoutTable)
      .select([
        lCols.templateId,
        lCols.primaryColor,
        lCols.bannerUrl,
      ])
      .whereEq(lCols.restaurantId, restaurant.id)
      .activeOnly()
      .compile();

    const layoutRes = await this.pool.query<typeof layoutQuery._result>(
      layoutQuery.text,
      layoutQuery.params,
    );
    const layout = layoutRes.rows[0];

    return {
      id: restaurant.id,
      name: restaurant.name,
      subdomain: restaurant.subdomain,
      postcodeSector: restaurant.postcodeSector,
      foodHygieneRating: restaurant.foodHygieneRating,
      averagePrepTimeMinutes: restaurant.averagePrepTimeMinutes,
      branding: layout
        ? {
            templateId: layout.templateId,
            primaryColor: layout.primaryColor,
            bannerUrl: layout.bannerUrl,
          }
        : null,
    };
  }
}

export interface GetRestaurantMenuSnapshotQuery extends Query<CompiledMenuSnapshot | null> {
  readonly restaurantId: string;
}

export class GetRestaurantMenuSnapshotHandler
  implements QueryHandler<GetRestaurantMenuSnapshotQuery, CompiledMenuSnapshot | null>
{
  constructor(
    private readonly catalogRepo: CatalogRepository,
    private readonly redis: RedisClientType,
  ) {}

  async execute(query: GetRestaurantMenuSnapshotQuery): Promise<CompiledMenuSnapshot | null> {
    const cacheKey = `menu:snapshot:${query.restaurantId}`;

    if (!this.redis.isOpen) {
      await this.redis.connect();
    }

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as CompiledMenuSnapshot;
    }

    const persisted = await this.catalogRepo.getPersistedSnapshot(query.restaurantId);
    if (persisted) {
      await this.redis.set(cacheKey, JSON.stringify(persisted), {
        EX: 3600,
      });
      return persisted;
    }

    const rebuilt = await this.catalogRepo.rebuildAndPersistSnapshot(
      query.restaurantId,
      SYSTEM_ACTORS.SYSTEM_CRON,
    );
    if (rebuilt) {
      await this.redis.set(cacheKey, JSON.stringify(rebuilt), {
        EX: 3600,
      });
    }

    return rebuilt;
  }
}
