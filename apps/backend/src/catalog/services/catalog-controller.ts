// FILE: apps/backend/src/catalog/services/catalog-controller.ts (Part 1 of 2)
import type { Context } from 'hono';
import type { CompiledMenuSnapshot } from '@/catalog/domain/menu-snapshot-builder';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import type { DomainError, Result } from '@/core/domain/result';

function mapDomainError(c: Context<AppEnv>, error: DomainError) {
  const payload = {
    code: error.code,
    error: error.message,
  };
  if (error.statusCode === 401) return c.json(payload, 401);
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
  // FILE: apps/backend/src/catalog/services/catalog-controller.ts (Part 2 of 2)
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
    const restaurantId =
      (body.restaurantId as string | undefined) ??
      this.request.supportGrant?.restaurantId ??
      this.request.restaurantId;
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
}
