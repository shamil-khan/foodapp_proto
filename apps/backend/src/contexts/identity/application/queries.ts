import { RestaurantStaffTable, sqlSelect, UserTable } from '@foodapp/db';
import type { Pool } from 'pg';
import type { RequestContext } from '@/container';
import type { Query, QueryHandler } from '@/core/application/cqrs';

export interface ActiveActorProfileDto {
  id: string;
  source: 'GLOBAL_USER' | 'POS_STAFF' | 'SYSTEM';
  name: string;
  email: string;
  role: string;
  restaurantId?: string;
}

export interface GetCurrentActorQuery extends Query<ActiveActorProfileDto | null> {}

export class GetCurrentActorHandler
  implements QueryHandler<GetCurrentActorQuery, ActiveActorProfileDto | null>
{
  constructor(
    private readonly pool: Pool,
    private readonly request: RequestContext,
  ) {}

  async execute(): Promise<ActiveActorProfileDto | null> {
    if (this.request.actorSource === 'POS_STAFF') {
      const { cols } = RestaurantStaffTable;
      const q = sqlSelect(RestaurantStaffTable)
        .select([
          cols.id,
          cols.name,
          cols.email,
          cols.role,
          cols.restaurantId,
        ])
        .whereEq(cols.id, this.request.actorId)
        .activeOnly()
        .compile();

      const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
      const staff = rows[0];
      if (!staff) return null;

      return {
        id: staff.id,
        source: 'POS_STAFF',
        name: staff.name,
        email: staff.email,
        role: staff.role,
        restaurantId: staff.restaurantId,
      };
    }

    if (this.request.actorSource === 'GLOBAL_USER') {
      const { cols } = UserTable;
      const q = sqlSelect(UserTable)
        .select([
          cols.id,
          cols.name,
          cols.email,
          cols.role,
        ])
        .whereEq(cols.id, this.request.actorId)
        .activeOnly()
        .compile();

      const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
      const user = rows[0];
      if (!user) return null;

      return {
        id: user.id,
        source: 'GLOBAL_USER',
        name: user.name,
        email: user.email,
        role: user.role,
      };
    }

    return null;
  }
}
