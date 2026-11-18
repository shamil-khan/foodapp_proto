import { FinancialLedgerTable, LoyaltyLedgerTable, type Pool, sqlSelect } from '@foodapp/db';
import type { AuthorizationPolicy } from '@/core/application/authorization';
import type { Query, QueryHandler } from '@/core/application/cqrs';
import { DomainError } from '@/core/domain/result';

export interface GetRestaurantLedgerQuery extends Query<unknown[]> {
  readonly restaurantId: string;
  readonly skip?: number;
  readonly take?: number;
}

export class GetRestaurantLedgerHandler
  implements QueryHandler<GetRestaurantLedgerQuery, unknown[]>
{
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;

  constructor(pool: Pool, authz: AuthorizationPolicy) {
    this.pool = pool;
    this.authz = authz;
  }

  async execute(query: GetRestaurantLedgerQuery): Promise<unknown[]> {
    const access = this.authz.assertRestaurantAccess(query.restaurantId, 'ledger:read');
    if (!access.ok) {
      throw new DomainError(access.error.code, access.error.message, 403);
    }

    const { cols } = FinancialLedgerTable;
    const q = sqlSelect(FinancialLedgerTable)
      .select([
        cols.id,
        cols.orderId,
        cols.entityName,
        cols.creditAmount,
        cols.debitAmount,
        cols.description,
        cols.createdAt,
      ])
      .whereEq(cols.entityName, `RESTAURANT_${query.restaurantId}`)
      .activeOnly()
      .orderBy(cols.createdAt, 'DESC')
      .skip(query.skip ?? 0)
      .take(query.take ?? 50)
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
    return rows;
  }
}

export interface GetUserLoyaltyBalanceQuery
  extends Query<{
    totalPoints: number;
    history: unknown[];
  }> {
  readonly userId: string;
}

export class GetUserLoyaltyBalanceHandler
  implements
    QueryHandler<
      GetUserLoyaltyBalanceQuery,
      {
        totalPoints: number;
        history: unknown[];
      }
    >
{
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;

  constructor(pool: Pool, authz: AuthorizationPolicy) {
    this.pool = pool;
    this.authz = authz;
  }

  async execute(query: GetUserLoyaltyBalanceQuery): Promise<{
    totalPoints: number;
    history: unknown[];
  }> {
    const access = this.authz.assertUserAccess(query.userId, 'loyalty:read');
    if (!access.ok) {
      throw new DomainError(access.error.code, access.error.message, 403);
    }

    const { cols } = LoyaltyLedgerTable;
    const q = sqlSelect(LoyaltyLedgerTable)
      .select([
        cols.id,
        cols.restaurantId,
        cols.orderId,
        cols.txType,
        cols.pointsDelta,
        cols.createdAt,
      ])
      .whereEq(cols.userId, query.userId)
      .activeOnly()
      .orderBy(cols.createdAt, 'DESC')
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
    const totalPoints = rows.reduce((sum, row) => sum + row.pointsDelta, 0);

    return {
      totalPoints,
      history: rows,
    };
  }
}
