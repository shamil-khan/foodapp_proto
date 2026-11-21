import { FinancialLedgerTable, LoyaltyLedgerTable, type Pool, sqlSelect } from '@foodapp/db';
import type { AuthorizationPolicy } from '@/core/application/authorization';
import type { Query, QueryHandler } from '@/core/application/cqrs';
import { DomainError } from '@/core/domain/result';

export interface LedgerEntryDto {
  id: string;
  orderId: string;
  entityName: string;
  creditAmount: string;
  debitAmount: string;
  description: string | null;
  createdAt: Date;
}

export interface GetRestaurantLedgerQuery extends Query<LedgerEntryDto[]> {
  readonly restaurantId: string;
  readonly skip?: number;
  readonly take?: number;
}

export class GetRestaurantLedgerHandler
  implements QueryHandler<GetRestaurantLedgerQuery, LedgerEntryDto[]>
{
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;

  constructor(pool: Pool, authz: AuthorizationPolicy) {
    this.pool = pool;
    this.authz = authz;
  }

  async execute(query: GetRestaurantLedgerQuery): Promise<LedgerEntryDto[]> {
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
      .activeOnly()
      .orderBy(cols.createdAt, 'DESC')
      .skip(query.skip ?? 0)
      .take(query.take ?? 50)
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
    return rows;
  }
}

export interface LoyaltySummaryDto {
  userId: string;
  totalPoints: number;
  recentTransactions: {
    id: string;
    branchId: string | null;
    orderId: string | null;
    txType: string;
    pointsDelta: number;
    createdAt: Date;
  }[];
}

export interface GetUserLoyaltyBalanceQuery extends Query<LoyaltySummaryDto> {
  readonly userId: string;
}

export class GetUserLoyaltyBalanceHandler
  implements QueryHandler<GetUserLoyaltyBalanceQuery, LoyaltySummaryDto>
{
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;

  constructor(pool: Pool, authz: AuthorizationPolicy) {
    this.pool = pool;
    this.authz = authz;
  }

  async execute(query: GetUserLoyaltyBalanceQuery): Promise<LoyaltySummaryDto> {
    const access = this.authz.assertUserAccess(query.userId, 'loyalty:read');
    if (!access.ok) {
      throw new DomainError(access.error.code, access.error.message, 403);
    }

    const { cols } = LoyaltyLedgerTable;
    const q = sqlSelect(LoyaltyLedgerTable)
      .select([
        cols.id,
        cols.branchId,
        cols.orderId,
        cols.txType,
        cols.pointsDelta,
        cols.createdAt,
      ])
      .whereEq(cols.userId, query.userId)
      .activeOnly()
      .orderBy(cols.createdAt, 'DESC')
      .take(50)
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
    const totalPoints = rows.reduce((sum, r) => sum + r.pointsDelta, 0);

    return {
      userId: query.userId,
      totalPoints,
      recentTransactions: rows,
    };
  }
}
