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

  async listRestaurants(c: Context<AppEnv>) {
    const postcodeSector = c.req.query('postcodeSector');
    const search = c.req.query('search');
    const skip = Number(c.req.query('skip') ?? 0);
    const take = Number(c.req.query('take') ?? 20);

    const restaurants = await this.queryBus.ask<StorefrontRestaurantDto[]>('GetRestaurants', {
      postcodeSector,
      search,
      skip,
      take,
    });

    return c.json({
      restaurants,
    });
  }

  async getMenuSnapshot(c: Context<AppEnv>) {
    const restaurantId = c.req.param('restaurantId');

    const snapshot = await this.queryBus.ask<CompiledMenuSnapshot | null>(
      'GetRestaurantMenuSnapshot',
      {
        restaurantId,
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

    return c.json(snapshot);
  }

  async updateItemPrice(c: Context<AppEnv>) {
    const menuItemId = c.req.param('itemId');
    const body = await c.req.json<{
      newBasePrice: number;
      expectedRowVersion: number;
    }>();

    const result = await this.commandBus.dispatch<Result<void, DomainError>>(
      'UpdateMenuItemPrice',
      {
        menuItemId,
        newBasePrice: body.newBasePrice,
        expectedRowVersion: body.expectedRowVersion,
      },
    );

    if (!result.ok) {
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        result.error.statusCode as 400 | 409,
      );
    }

    return c.json({
      success: true,
      menuItemId,
    });
  }
}
