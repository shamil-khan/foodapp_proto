import { FinancialLedgerTable, LoyaltyLedgerTable, sqlSelect } from '@foodapp/db';
import type { Pool } from 'pg';
import type { Query, QueryHandler } from '@/core/application/cqrs';

export interface GetRestaurantLedgerQuery extends Query<unknown[]> {
  readonly restaurantId: string;
  readonly skip?: number;
  readonly take?: number;
}

export class GetRestaurantLedgerHandler
  implements QueryHandler<GetRestaurantLedgerQuery, unknown[]>
{
  constructor(private readonly pool: Pool) {}

  async execute(query: GetRestaurantLedgerQuery) {
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
  constructor(private readonly pool: Pool) {}

  async execute(query: GetUserLoyaltyBalanceQuery) {
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
