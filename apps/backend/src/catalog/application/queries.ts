import {
  type HomePickupPrivacyMode,
  type KitchenType,
  type OperationalStatus,
  type Pool,
  RestaurantBranchTable,
  RestaurantLayoutTable,
  RestaurantTable,
  type redisClient,
  SYSTEM_ACTORS,
  sqlSelect,
} from '@foodapp/db';
import {
  type DropPointConfig,
  type ProjectedBranchLocation,
  projectBranchLocationForViewer,
  type TakeawayWhitelistEntry,
} from '@/catalog/domain/location-privacy';
import type { CompiledMenuSnapshot } from '@/catalog/domain/menu-snapshot-builder';
import type { BranchStatusCache } from '@/catalog/infrastructure/branch-status-cache';
import type { CatalogRepository } from '@/catalog/infrastructure/catalog-repository';
import type { RequestContext } from '@/core/application/authorization';
import type { Query, QueryHandler } from '@/core/application/cqrs';

type RedisClientType = typeof redisClient;

export interface StorefrontBranchDto {
  id: string;
  restaurantId: string;
  name: string;
  branchKey: string;
  city: string;
  cityKey: string;
  kitchenType: KitchenType;
  operationalStatus: OperationalStatus;
  statusLockedUntil: string | null;
  supportsDineIn: boolean;
  supportsTakeaway: boolean;
  supportsPlatformDelivery: boolean;
  averagePrepTimeMinutes: number;
  scheduleConfig: Record<string, unknown>;
  location: ProjectedBranchLocation;
}

export interface StorefrontBrandDto {
  id: string;
  name: string;
  handle: string;
  logoUrl: string | null;
  description: string | null;
  foodHygieneRating: number | null;
  branding: {
    templateId: string;
    primaryColor: string;
    bannerUrl: string | null;
    galleryImages: unknown;
  } | null;
}

export type BrandStorefrontResponseDto =
  | {
      resolutionType: 'SINGLE_LOCATION';
      brand: StorefrontBrandDto;
      branch: StorefrontBranchDto;
    }
  | {
      resolutionType: 'MULTI_BRANCH';
      brand: StorefrontBrandDto;
      cities: {
        city: string;
        cityKey: string;
        branches: StorefrontBranchDto[];
      }[];
    };

export interface ListBrandsQuery extends Query<StorefrontBrandDto[]> {
  readonly search?: string;
  readonly skip?: number;
  readonly take?: number;
}

export class ListBrandsHandler implements QueryHandler<ListBrandsQuery, StorefrontBrandDto[]> {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async execute(query: ListBrandsQuery): Promise<StorefrontBrandDto[]> {
    const rCols = RestaurantTable.cols;
    const builder = sqlSelect(RestaurantTable)
      .select([
        rCols.id,
        rCols.name,
        rCols.handle,
        rCols.logoUrl,
        rCols.description,
        rCols.foodHygieneRating,
      ])
      .whereEq(rCols.isActiveOverride, true)
      .activeOnly();

    if (query.search?.trim()) {
      builder.whereILike(rCols.name, `%${query.search.trim()}%`);
    }

    const q = builder
      .orderBy(rCols.name, 'ASC')
      .skip(query.skip ?? 0)
      .take(Math.min(query.take ?? 20, 100))
      .compile();
    const { rows: brands } = await this.pool.query<typeof q._result>(q.text, q.params);
    if (brands.length === 0) return [];

    const lCols = RestaurantLayoutTable.cols;
    const lq = sqlSelect(RestaurantLayoutTable)
      .select([
        lCols.restaurantId,
        lCols.templateId,
        lCols.primaryColor,
        lCols.bannerUrl,
        lCols.galleryImages,
      ])
      .whereIn(
        lCols.restaurantId,
        brands.map((b) => b.id),
      )
      .activeOnly()
      .compile();
    const { rows: layouts } = await this.pool.query<typeof lq._result>(lq.text, lq.params);
    const layoutMap = new Map(
      layouts.map((l) => [
        l.restaurantId,
        l,
      ]),
    );

    return brands.map((b) => {
      const layout = layoutMap.get(b.id);
      return {
        id: b.id,
        name: b.name,
        handle: b.handle,
        logoUrl: b.logoUrl,
        description: b.description,
        foodHygieneRating: b.foodHygieneRating,
        branding: layout
          ? {
              templateId: layout.templateId,
              primaryColor: layout.primaryColor,
              bannerUrl: layout.bannerUrl,
              galleryImages: layout.galleryImages,
            }
          : null,
      };
    });
  }
}

export interface ResolveBrandByHandleQuery extends Query<BrandStorefrontResponseDto | null> {
  readonly brandHandle: string;
}

export class ResolveBrandByHandleHandler
  implements QueryHandler<ResolveBrandByHandleQuery, BrandStorefrontResponseDto | null>
{
  private readonly pool: Pool;
  private readonly statusCache: BranchStatusCache;
  private readonly request: RequestContext;

  constructor(pool: Pool, statusCache: BranchStatusCache, request: RequestContext) {
    this.pool = pool;
    this.statusCache = statusCache;
    this.request = request;
  }

  async execute(query: ResolveBrandByHandleQuery): Promise<BrandStorefrontResponseDto | null> {
    const rCols = RestaurantTable.cols;
    const rq = sqlSelect(RestaurantTable)
      .select([
        rCols.id,
        rCols.name,
        rCols.handle,
        rCols.logoUrl,
        rCols.description,
        rCols.foodHygieneRating,
      ])
      .whereEq(rCols.handle, query.brandHandle.trim().toLowerCase())
      .whereEq(rCols.isActiveOverride, true)
      .activeOnly()
      .compile();
    const rRes = await this.pool.query<typeof rq._result>(rq.text, rq.params);
    const brandRow = rRes.rows[0];
    if (!brandRow) return null;

    const lCols = RestaurantLayoutTable.cols;
    const lq = sqlSelect(RestaurantLayoutTable)
      .select([
        lCols.templateId,
        lCols.primaryColor,
        lCols.bannerUrl,
        lCols.galleryImages,
      ])
      .whereEq(lCols.restaurantId, brandRow.id)
      .activeOnly()
      .compile();
    const lRes = await this.pool.query<typeof lq._result>(lq.text, lq.params);
    const layout = lRes.rows[0];

    const brand: StorefrontBrandDto = {
      id: brandRow.id,
      name: brandRow.name,
      handle: brandRow.handle,
      logoUrl: brandRow.logoUrl,
      description: brandRow.description,
      foodHygieneRating: brandRow.foodHygieneRating,
      branding: layout
        ? {
            templateId: layout.templateId,
            primaryColor: layout.primaryColor,
            bannerUrl: layout.bannerUrl,
            galleryImages: layout.galleryImages,
          }
        : null,
    };

    const bCols = RestaurantBranchTable.cols;
    const bq = sqlSelect(RestaurantBranchTable)
      .whereEq(bCols.restaurantId, brandRow.id)
      .whereEq(bCols.isActive, true)
      .activeOnly()
      .orderBy(bCols.city, 'ASC')
      .orderBy(bCols.name, 'ASC')
      .compile();
    const { rows: branchRows } = await this.pool.query<typeof bq._result>(bq.text, bq.params);
    if (branchRows.length === 0) return null;

    const isPrivileged =
      this.request.actorSource === 'POS_STAFF' && this.request.restaurantId === brandRow.id;
    const viewerUserId =
      this.request.actorSource === 'GLOBAL_USER' ? this.request.actorId : undefined;

    const branches: StorefrontBranchDto[] = await Promise.all(
      branchRows.map(async (b) => {
        const cachedStatus = await this.statusCache.getStatus(b.id);
        return {
          id: b.id,
          restaurantId: b.restaurantId,
          name: b.name,
          branchKey: b.branchKey,
          city: b.city,
          cityKey: b.cityKey,
          kitchenType: b.kitchenType as KitchenType,
          operationalStatus: (cachedStatus?.operationalStatus ??
            b.operationalStatus) as OperationalStatus,
          statusLockedUntil:
            cachedStatus?.statusLockedUntil ??
            (b.statusLockedUntil ? new Date(b.statusLockedUntil).toISOString() : null),
          supportsDineIn: b.supportsDineIn,
          supportsTakeaway: b.supportsTakeaway,
          supportsPlatformDelivery: b.supportsPlatformDelivery,
          averagePrepTimeMinutes: b.averagePrepTimeMinutes,
          scheduleConfig: b.scheduleConfig,
          location: projectBranchLocationForViewer(
            {
              kitchenType: b.kitchenType as KitchenType,
              postcodeSector: b.postcodeSector,
              streetAddress: b.streetAddress,
              areaLocality: b.areaLocality,
              latitude: b.latitude,
              longitude: b.longitude,
              contactPersonName: b.contactPersonName,
              contactPersonPhone: b.contactPersonPhone,
              contactPersonEmail: b.contactPersonEmail,
              supportsTakeaway: b.supportsTakeaway,
              homePickupPrivacyMode: b.homePickupPrivacyMode as HomePickupPrivacyMode,
              dropPointConfig: b.dropPointConfig as unknown as DropPointConfig | null,
              approvedTakeawayUserIds: Array.isArray(b.approvedTakeawayUserIds)
                ? (b.approvedTakeawayUserIds as unknown as TakeawayWhitelistEntry[])
                : [],
            },
            {
              userId: viewerUserId,
              isPrivilegedStaffOrRider: isPrivileged,
            },
          ),
        };
      }),
    );

    if (branches.length === 1 && branches[0]) {
      return {
        resolutionType: 'SINGLE_LOCATION',
        brand,
        branch: branches[0],
      };
    }

    const cityGroups = new Map<
      string,
      {
        city: string;
        cityKey: string;
        branches: StorefrontBranchDto[];
      }
    >();
    for (const br of branches) {
      const grp = cityGroups.get(br.cityKey) ?? {
        city: br.city,
        cityKey: br.cityKey,
        branches: [],
      };
      grp.branches.push(br);
      cityGroups.set(br.cityKey, grp);
    }

    return {
      resolutionType: 'MULTI_BRANCH',
      brand,
      cities: Array.from(cityGroups.values()),
    };
  }
}

export interface ResolveBranchBySlugQuery
  extends Query<{
    brand: StorefrontBrandDto;
    branch: StorefrontBranchDto;
  } | null> {
  readonly brandHandle: string;
  readonly city: string;
  readonly branch: string;
}

export class ResolveBranchBySlugHandler
  implements
    QueryHandler<
      ResolveBranchBySlugQuery,
      {
        brand: StorefrontBrandDto;
        branch: StorefrontBranchDto;
      } | null
    >
{
  private readonly resolver: ResolveBrandByHandleHandler;

  constructor(pool: Pool, statusCache: BranchStatusCache, request: RequestContext) {
    this.resolver = new ResolveBrandByHandleHandler(pool, statusCache, request);
  }

  async execute(query: ResolveBranchBySlugQuery): Promise<{
    brand: StorefrontBrandDto;
    branch: StorefrontBranchDto;
  } | null> {
    const resolved = await this.resolver.execute({
      brandHandle: query.brandHandle,
    });
    if (!resolved) return null;

    const cleanCity = query.city.trim().toLowerCase();
    const cleanBranch = query.branch.trim().toLowerCase();

    if (resolved.resolutionType === 'SINGLE_LOCATION') {
      return resolved.branch.cityKey === cleanCity && resolved.branch.branchKey === cleanBranch
        ? {
            brand: resolved.brand,
            branch: resolved.branch,
          }
        : null;
    }

    const cityMatch = resolved.cities.find((c) => c.cityKey === cleanCity);
    const branchMatch = cityMatch?.branches.find((b) => b.branchKey === cleanBranch);
    return branchMatch
      ? {
          brand: resolved.brand,
          branch: branchMatch,
        }
      : null;
  }
}

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
