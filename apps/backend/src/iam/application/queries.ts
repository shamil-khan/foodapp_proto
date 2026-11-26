import { RestaurantStaffTable, sqlSelect, UserTable } from '@foodapp/db';
import type { RequestContext } from '@/container';
import type { Query, QueryHandler } from '@/core/application/cqrs';
import type { ReadRepository } from '@/core/infrastructure/read-repository';

export interface ActiveActorProfileDto {
  id: string;
  source: 'ANONYMOUS' | 'CUSTOMER' | 'POS_STAFF' | 'PLATFORM_STAFF';
  name: string;
  email: string;
  role: string;
  restaurantId?: string;
  branchId?: string;
}

export interface GetCurrentActorQuery extends Query<ActiveActorProfileDto | null> {}

export class GetCurrentActorHandler
  implements QueryHandler<GetCurrentActorQuery, ActiveActorProfileDto | null>
{
  private readonly readRepo: ReadRepository;
  private readonly request: RequestContext;

  constructor(readRepo: ReadRepository, request: RequestContext) {
    this.readRepo = readRepo;
    this.request = request;
  }

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

      const staff = await this.readRepo.findOne(q);
      if (!staff) return null;

      return {
        id: staff.id,
        source: 'POS_STAFF',
        name: staff.name,
        email: staff.email,
        role: staff.role,
        restaurantId: staff.restaurantId,
        branchId: this.request.branchId,
      };
    }

    if (this.request.actorSource === 'CUSTOMER' || this.request.actorSource === 'PLATFORM_STAFF') {
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

      const user = await this.readRepo.findOne(q);
      if (!user) return null;

      return {
        id: user.id,
        source: this.request.actorSource,
        name: user.name,
        email: user.email,
        role: user.role,
      };
    }

    return null;
  }
}
