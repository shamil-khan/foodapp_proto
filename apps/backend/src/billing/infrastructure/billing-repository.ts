import {
  FinancialLedgerTable,
  MerchantSettlementTable,
  type Pool,
  type PoolClient,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import type { FinancialLedgerState } from '@/billing/domain/billing-aggregate';
import type { JournalLineSpec } from '@/billing/domain/billing-events';
import type { RequestContext } from '@/core/application/authorization';
import { formatGbp } from '@/core/domain/money';
import { ScopedRepository } from '@/core/infrastructure/scoped-repository';

export class BillingRepository extends ScopedRepository {
  private readonly pool: Pool;

  constructor(pool: Pool, request: RequestContext) {
    super(request);
    this.pool = pool;
  }

  async loadRestaurantLedgerState(restaurantId: string): Promise<FinancialLedgerState> {
    this.resolveRestaurantScope(restaurantId);

    const fCols = FinancialLedgerTable.cols;
    const q = sqlSelect(FinancialLedgerTable)
      .select([
        fCols.orderId,
        fCols.accountCode,
        fCols.creditAmount,
        fCols.debitAmount,
      ])
      .whereEq(fCols.restaurantId, restaurantId)
      .whereNull(fCols.settlementId)
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);

    let payable = new Decimal(0);
    let cashReceivable = new Decimal(0);
    const settledOrderIds = new Set<string>();

    for (const r of rows) {
      if (r.orderId) settledOrderIds.add(r.orderId);
      const credit = new Decimal(r.creditAmount);
      const debit = new Decimal(r.debitAmount);
      if (r.accountCode === 'MERCHANT_PAYABLE') {
        payable = payable.plus(credit).minus(debit);
      } else if (r.accountCode === 'MERCHANT_CASH_RECEIVABLE') {
        cashReceivable = cashReceivable.plus(debit).minus(credit);
      }
    }

    return {
      restaurantId,
      merchantPayableGbp: formatGbp(payable),
      cashCommissionReceivableGbp: formatGbp(cashReceivable),
      settledOrderIds: [
        ...settledOrderIds,
      ],
    };
  }

  async appendJournalLines(
    params: {
      readonly orderId: string;
      readonly branchId: string;
      readonly restaurantId: string;
      readonly lines: readonly JournalLineSpec[];
      readonly actorId: string;
    },
    client?: PoolClient,
  ): Promise<void> {
    const executor = client ?? this.pool;
    for (const line of params.lines) {
      const ins = sqlInsert(FinancialLedgerTable)
        .values({
          orderId: params.orderId,
          restaurantId: params.restaurantId,
          entityName: `${line.accountCode}:${params.branchId}`,
          accountCode: line.accountCode,
          debitAmount: line.side === 'DEBIT' ? line.amountGbp : '0.00',
          creditAmount: line.side === 'CREDIT' ? line.amountGbp : '0.00',
          description: line.description,
          createdBy: params.actorId,
          updatedBy: params.actorId,
        })
        .compile();
      await executor.query(ins.text, ins.params);
    }
  }

  async getUnsettledCashReceivableTotal(restaurantId: string): Promise<Decimal> {
    const fCols = FinancialLedgerTable.cols;
    const q = sqlSelect(FinancialLedgerTable)
      .select([
        fCols.debitAmount,
        fCols.creditAmount,
      ])
      .whereEq(fCols.restaurantId, restaurantId)
      .whereEq(fCols.accountCode, 'MERCHANT_CASH_RECEIVABLE')
      .whereNull(fCols.settlementId)
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
    let total = new Decimal(0);
    for (const r of rows) {
      total = total.plus(r.debitAmount).minus(r.creditAmount);
    }
    return total;
  }

  async createMerchantSettlement(
    data: {
      readonly restaurantId: string;
      readonly periodStart: Date;
      readonly periodEnd: Date;
      readonly grossOnlinePayableGbp: string;
      readonly cashCommissionReceivableGbp: string;
      readonly loyaltyFeeOffsetGbp: string;
      readonly commissionVatGbp: string;
      readonly netPayoutGbp: string;
      readonly status: 'PENDING_PAYOUT' | 'PAID' | 'HELD_FROZEN';
      readonly actorId: string;
    },
    client: PoolClient,
  ): Promise<string> {
    const mCols = MerchantSettlementTable.cols;
    const ins = sqlInsert(MerchantSettlementTable)
      .values({
        restaurantId: data.restaurantId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        grossOnlinePayableGbp: data.grossOnlinePayableGbp,
        cashCommissionReceivableGbp: data.cashCommissionReceivableGbp,
        loyaltyFeeOffsetGbp: data.loyaltyFeeOffsetGbp,
        commissionVatGbp: data.commissionVatGbp,
        netPayoutGbp: data.netPayoutGbp,
        status: data.status,
        createdBy: data.actorId,
        updatedBy: data.actorId,
      })
      .returning([
        mCols.id,
      ])
      .compile();

    const res = await client.query<typeof ins._result>(ins.text, ins.params);
    const settlementId = res.rows[0]?.id ?? '';

    const fCols = FinancialLedgerTable.cols;
    const bind = sqlUpdate(FinancialLedgerTable)
      .set({
        settlementId,
      })
      .withAuditBump(data.actorId)
      .whereEq(fCols.restaurantId, data.restaurantId)
      .whereNull(fCols.settlementId)
      .whereNull(fCols.deletedAt)
      .compile();
    await client.query(bind.text, bind.params);

    return settlementId;
  }
}
