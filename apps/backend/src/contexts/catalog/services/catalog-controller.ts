import type { Context } from 'hono';
import type { AppEnv } from '@/container';
import type { StorefrontRestaurantDto } from '@/contexts/catalog/application/queries';
import type { CompiledMenuSnapshot } from '@/contexts/catalog/domain/menu-snapshot-builder';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import type { DomainError, Result } from '@/core/domain/result';

export class CatalogController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  async listRestaurants(
    c: Context<AppEnv>,
    query: {
      postcodeSector?: string;
      search?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const restaurants = await this.queryBus.ask<StorefrontRestaurantDto[]>('GetRestaurants', {
      postcodeSector: query.postcodeSector,
      search: query.search,
      skip: query.skip ?? 0,
      take: query.take ?? 20,
    });

    return c.json(
      {
        restaurants,
      },
      200,
    );
  }

  async getMenuSnapshot(
    c: Context<AppEnv>,
    params: {
      restaurantId: string;
    },
  ) {
    const snapshot = await this.queryBus.ask<CompiledMenuSnapshot | null>(
      'GetRestaurantMenuSnapshot',
      {
        restaurantId: params.restaurantId,
      },
    );

    if (!snapshot) {
      return c.json(
        {
          error: 'Restaurant menu not found',
        },
        404,
      );
    }

    return c.json(snapshot, 200);
  }

  async updateItemPrice(
    c: Context<AppEnv>,
    params: {
      itemId: string;
    },
    body: {
      newBasePrice: number;
      expectedRowVersion: number;
    },
  ) {
    const result = await this.commandBus.dispatch<Result<void, DomainError>>(
      'UpdateMenuItemPrice',
      {
        menuItemId: params.itemId,
        newBasePrice: body.newBasePrice,
        expectedRowVersion: body.expectedRowVersion,
      },
    );

    if (!result.ok) {
      const status = result.error.statusCode === 409 ? 409 : 400;
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        status,
      );
    }

    return c.json(
      {
        success: true as const,
        menuItemId: params.itemId,
      },
      200,
    );
  }
}
