import type { Context } from 'hono';
import type {
  BrandStorefrontResponseDto,
  StorefrontBranchDto,
  StorefrontBrandDto,
} from '@/catalog/application/queries';
import type { CompiledMenuSnapshot } from '@/catalog/domain/menu-snapshot-builder';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import type { DomainError, Result } from '@/core/domain/result';

function mapDomainError(c: Context<AppEnv>, error: DomainError) {
  const payload = {
    code: error.code,
    error: error.message,
  };
  if (error.statusCode === 403) return c.json(payload, 403);
  if (error.statusCode === 404) return c.json(payload, 404);
  if (error.statusCode === 409) return c.json(payload, 409);
  return c.json(payload, 400);
}

export class CatalogController {
  private readonly commandBus: CommandBus;
  private readonly queryBus: QueryBus;
  private readonly request: RequestContext;

  constructor(commandBus: CommandBus, queryBus: QueryBus, request: RequestContext) {
    this.commandBus = commandBus;
    this.queryBus = queryBus;
    this.request = request;
  }

  async listBrands(
    c: Context<AppEnv>,
    query: {
      search?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const brands = await this.queryBus.ask<StorefrontBrandDto[]>('ListBrands', query);
    return c.json(
      {
        brands,
      },
      200,
    );
  }

  async registerBrand(c: Context<AppEnv>, body: Record<string, unknown>) {
    const result = await this.commandBus.dispatch<Result<Record<string, unknown>, DomainError>>(
      'RegisterBrand',
      body,
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(result.value, 201);
  }

  async resolveBrandByHandle(
    c: Context<AppEnv>,
    params: {
      brand: string;
    },
  ) {
    const resolved = await this.queryBus.ask<BrandStorefrontResponseDto | null>(
      'ResolveBrandByHandle',
      {
        brandHandle: params.brand,
      },
    );
    if (!resolved)
      return c.json(
        {
          code: 'NOT_FOUND',
          error: 'Brand not found or suspended',
        },
        404,
      );
    return c.json(resolved, 200);
  }

  async resolveBranchBySlug(
    c: Context<AppEnv>,
    params: {
      brand: string;
      city: string;
      branch: string;
    },
  ) {
    const resolved = await this.queryBus.ask<{
      brand: StorefrontBrandDto;
      branch: StorefrontBranchDto;
    } | null>('ResolveBranchBySlug', {
      brandHandle: params.brand,
      city: params.city,
      branch: params.branch,
    });
    if (!resolved)
      return c.json(
        {
          code: 'NOT_FOUND',
          error: 'Branch not found',
        },
        404,
      );
    return c.json(resolved, 200);
  }

  async getBranchMenuSnapshot(
    c: Context<AppEnv>,
    params: {
      branchId: string;
    },
    query: {
      tag?: string;
    },
  ) {
    const snapshot = await this.queryBus.ask<CompiledMenuSnapshot | null>('GetBranchMenuSnapshot', {
      branchId: params.branchId,
      tag: query.tag,
    });
    if (!snapshot)
      return c.json(
        {
          code: 'NOT_FOUND',
          error: 'Branch menu not found',
        },
        404,
      );
    return c.json(snapshot, 200);
  }

  async createBrandBranch(c: Context<AppEnv>, body: Record<string, unknown>) {
    const restaurantId = (body.restaurantId as string | undefined) ?? this.request.restaurantId;
    if (!restaurantId)
      return c.json(
        {
          code: 'MISSING_TENANT',
          error: 'restaurantId is required',
        },
        403,
      );
    const result = await this.commandBus.dispatch<Result<Record<string, unknown>, DomainError>>(
      'CreateBrandBranch',
      {
        ...body,
        restaurantId,
      },
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(result.value, 201);
  }

  async updateBranchStatus(
    c: Context<AppEnv>,
    params: {
      branchId: string;
    },
    body: Record<string, unknown>,
  ) {
    const result = await this.commandBus.dispatch<Result<Record<string, unknown>, DomainError>>(
      'UpdateBranchOperationalStatus',
      {
        branchId: params.branchId,
        ...body,
      },
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(result.value, 200);
  }

  async updateBranchSettings(
    c: Context<AppEnv>,
    params: {
      branchId: string;
    },
    body: Record<string, unknown>,
  ) {
    const result = await this.commandBus.dispatch<Result<void, DomainError>>(
      'UpdateBranchSettings',
      {
        branchId: params.branchId,
        ...body,
      },
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }

  async reviewWhitelist(
    c: Context<AppEnv>,
    params: {
      branchId: string;
    },
    body: Record<string, unknown>,
  ) {
    const result = await this.commandBus.dispatch<Result<void, DomainError>>(
      'ReviewTakeawayWhitelist',
      {
        branchId: params.branchId,
        ...body,
      },
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }

  async upsertPricingPolicy(c: Context<AppEnv>, body: Record<string, unknown>) {
    const restaurantId = (body.restaurantId as string | undefined) ?? this.request.restaurantId;
    if (!restaurantId)
      return c.json(
        {
          code: 'MISSING_TENANT',
          error: 'restaurantId is required',
        },
        403,
      );
    const result = await this.commandBus.dispatch<Result<void, DomainError>>(
      'UpsertPricingPolicy',
      {
        ...body,
        restaurantId,
      },
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }

  async upsertBranchMenuOverride(
    c: Context<AppEnv>,
    params: {
      branchId: string;
      itemId: string;
    },
    body: Record<string, unknown>,
  ) {
    const result = await this.commandBus.dispatch<Result<Record<string, unknown>, DomainError>>(
      'UpsertBranchMenuOverride',
      {
        branchId: params.branchId,
        menuItemId: params.itemId,
        ...body,
      },
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(result.value, 200);
  }

  async reviewPriceOverride(
    c: Context<AppEnv>,
    params: {
      branchId: string;
      itemId: string;
    },
    body: Record<string, unknown>,
  ) {
    const result = await this.commandBus.dispatch<Result<void, DomainError>>(
      'ReviewPriceOverride',
      {
        branchId: params.branchId,
        menuItemId: params.itemId,
        ...body,
      },
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }

  async createMenuItem(c: Context<AppEnv>, body: Record<string, unknown>) {
    const restaurantId = (body.restaurantId as string | undefined) ?? this.request.restaurantId;
    if (!restaurantId)
      return c.json(
        {
          code: 'MISSING_TENANT',
          error: 'restaurantId is required',
        },
        403,
      );
    const result = await this.commandBus.dispatch<Result<Record<string, unknown>, DomainError>>(
      'CreateMenuItem',
      {
        ...body,
        restaurantId,
      },
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(result.value, 201);
  }

  async createBrandByAdmin(c: Context<AppEnv>, body: Record<string, unknown>) {
    const result = await this.commandBus.dispatch<Result<Record<string, unknown>, DomainError>>(
      'CreateRestaurantByAdmin',
      {
        name: body.brandName,
        ...body,
      },
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(result.value, 201);
  }

  async updateBrandStatusByAdmin(
    c: Context<AppEnv>,
    params: {
      restaurantId: string;
    },
    body: {
      isActive: boolean;
    },
  ) {
    const result = await this.commandBus.dispatch<Result<void, DomainError>>(
      'UpdateRestaurantStatusByAdmin',
      {
        restaurantId: params.restaurantId,
        isActive: body.isActive,
      },
    );
    if (!result.ok) return mapDomainError(c, result.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }
}
