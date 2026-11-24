import { FinancialLedgerTable, MerchantSettlementTable, type Pool, sqlSelect } from '@foodapp/db';
import type { BillingRepository } from '@/billing/infrastructure/billing-repository';
import type { AuthorizationPolicy } from '@/core/application/authorization';
import type { Query, QueryHandler } from '@/core/application/cqrs';
import { DomainError } from '@/core/domain/result';

export interface RestaurantBillingSummaryDto {
  readonly restaurantId: string;
  readonly unsettledOnlinePayableGbp: string;
  readonly unsettledCashReceivableGbp: string;
  readonly recentJournalLines: {
    readonly id: string;
    readonly orderId: string | null;
    readonly accountCode: string;
    readonly entryType: 'DEBIT' | 'CREDIT';
    readonly amount: string;
    readonly description: string;
    readonly createdAt: string;
  }[];
  readonly settlements: {
    readonly id: string;
    readonly grossOnlinePayableGbp: string;
    readonly cashCommissionReceivableGbp: string;
    readonly loyaltyFeeOffsetGbp: string;
    readonly netPayoutGbp: string;
    readonly status: string;
    readonly payoutReference: string | null;
  }[];
}

export interface GetRestaurantBillingQuery extends Query<RestaurantBillingSummaryDto> {
  readonly restaurantId: string;
}

export class GetRestaurantBillingHandler
  implements QueryHandler<GetRestaurantBillingQuery, RestaurantBillingSummaryDto>
{
  private readonly pool: Pool;
  private readonly repo: BillingRepository;
  private readonly authz: AuthorizationPolicy;

  constructor(pool: Pool, repo: BillingRepository, authz: AuthorizationPolicy) {
    this.pool = pool;
    this.repo = repo;
    this.authz = authz;
  }

  async execute(query: GetRestaurantBillingQuery): Promise<RestaurantBillingSummaryDto> {
    if (!this.authz.isPlatformAdmin()) {
      const access = this.authz.assertRestaurantAccess(query.restaurantId, 'ledger:read');
      if (!access.ok) {
        throw new DomainError(access.error.code, access.error.message, 403);
      }
    }

    const state = await this.repo.loadRestaurantLedgerState(query.restaurantId);
    const fCols = FinancialLedgerTable.cols;
    const jQ = sqlSelect(FinancialLedgerTable)
      .select([
        fCols.id,
        fCols.orderId,
        fCols.accountCode,
        fCols.debitAmount,
        fCols.creditAmount,
        fCols.description,
        fCols.createdAt,
      ])
      .whereEq(fCols.restaurantId, query.restaurantId)
      .activeOnly()
      .orderBy(fCols.createdAt, 'DESC')
      .take(50)
      .compile();

    const mCols = MerchantSettlementTable.cols;
    const sQ = sqlSelect(MerchantSettlementTable)
      .whereEq(mCols.restaurantId, query.restaurantId)
      .activeOnly()
      .orderBy(mCols.createdAt, 'DESC')
      .take(20)
      .compile();

    const [jRows, sRows] = await Promise.all([
      this.pool.query<typeof jQ._result>(jQ.text, jQ.params),
      this.pool.query<typeof sQ._result>(sQ.text, sQ.params),
    ]);

    return {
      restaurantId: query.restaurantId,
      unsettledOnlinePayableGbp: state.merchantPayableGbp,
      unsettledCashReceivableGbp: state.cashCommissionReceivableGbp,
      recentJournalLines: jRows.rows.map((r) => {
        const isDebit = Number.parseFloat(r.debitAmount) > 0;
        return {
          id: r.id,
          orderId: r.orderId,
          accountCode: r.accountCode,
          entryType: isDebit ? ('DEBIT' as const) : ('CREDIT' as const),
          amount: isDebit ? r.debitAmount : r.creditAmount,
          description: r.description ?? '',
          createdAt: new Date(r.createdAt).toISOString(),
        };
      }),
      settlements: sRows.rows.map((s) => ({
        id: s.id,
        grossOnlinePayableGbp: s.grossOnlinePayableGbp,
        cashCommissionReceivableGbp: s.cashCommissionReceivableGbp,
        loyaltyFeeOffsetGbp: s.loyaltyFeeOffsetGbp,
        netPayoutGbp: s.netPayoutGbp,
        status: s.status,
        payoutReference: s.payoutReference,
      })),
    };
  }
}
