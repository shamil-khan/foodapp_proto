import {
  type DbExecutor,
  FinancialLedgerTable,
  MerchantSettlementTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
  type UnitOfWork,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import type { FinancialLedgerState } from '@/billing/domain/billing-aggregate';
import type { JournalLineSpec } from '@/billing/domain/billing-events';
import type { RequestContext } from '@/core/application/authorization';
import { formatGbp } from '@/core/domain/money';
import { ScopedRepository } from '@/core/infrastructure/scoped-repository';

export class BillingRepository extends ScopedRepository {
  private readonly uow: UnitOfWork;

  constructor(uow: UnitOfWork, request: RequestContext) {
    super(request);
    this.uow = uow;
  }

  async loadRestaurantLedgerState(
    restaurantId: string,
    tx: DbExecutor = this.uow,
  ): Promise<FinancialLedgerState> {
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

    const rows = await tx.queryMany(q);

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
    tx: DbExecutor = this.uow,
  ): Promise<void> {
    // Write all balanced double-entry journal lines atomically within a single UnitOfWork
    const writeLines = async (exec: DbExecutor): Promise<void> => {
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
        await exec.execute(ins);
      }
    };

    if (tx === this.uow) {
      await this.uow.transaction(writeLines);
      return;
    }
    await writeLines(tx);
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

    const rows = await this.uow.queryMany(q);
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
    tx: DbExecutor,
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

    const inserted = await tx.queryOne(ins);
    const settlementId = inserted?.id ?? '';

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
    await tx.execute(bind);

    return settlementId;
  }
}
