import Decimal from 'decimal.js';
import type {
  BillingRefundRecordedPayload,
  BillingSettlementRecordedPayload,
  JournalLineSpec,
  PaymentChannelMode,
} from '@/billing/domain/billing-events';
import { AggregateRoot } from '@/core/domain/aggregate-root';
import type { DomainEvent, EventMetadata } from '@/core/domain/domain-event';
import { formatGbp, money, roundGbp } from '@/core/domain/money';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export interface FinancialLedgerState {
  restaurantId: string;
  merchantPayableGbp: string;
  cashCommissionReceivableGbp: string;
  settledOrderIds: string[];
}

const INITIAL_LEDGER_STATE: FinancialLedgerState = {
  restaurantId: '',
  merchantPayableGbp: '0.00',
  cashCommissionReceivableGbp: '0.00',
  settledOrderIds: [],
};

export interface RecordOrderSettlementInput {
  readonly orderId: string;
  readonly branchId: string;
  readonly restaurantId: string;
  readonly customerId?: string;
  readonly paymentMode: PaymentChannelMode;
  readonly gatewayReference?: string;
  readonly subtotalGbp: Decimal;
  readonly vatGbp: Decimal;
  readonly deliveryFeeGbp: Decimal;
  readonly loyaltyDiscountGbp: Decimal;
  readonly commissionRatePercent: Decimal;
  readonly commissionVatGbp: Decimal;
  readonly allowLoyaltyEarn: boolean;
}

export class FinancialLedgerAggregate extends AggregateRoot<FinancialLedgerState> {
  private constructor(
    id: string,
    state: FinancialLedgerState = structuredClone(INITIAL_LEDGER_STATE),
  ) {
    super(id, 'FinancialLedgerAggregate', state);
  }

  public static create(restaurantId: string): FinancialLedgerAggregate {
    return new FinancialLedgerAggregate(restaurantId, {
      ...structuredClone(INITIAL_LEDGER_STATE),
      restaurantId,
    });
  }

  public static fromSnapshot(id: string, state: FinancialLedgerState): FinancialLedgerAggregate {
    return new FinancialLedgerAggregate(id, state);
  }

  public static assertBalanced(lines: readonly JournalLineSpec[]): Result<void> {
    let debits = new Decimal(0);
    let credits = new Decimal(0);
    for (const line of lines) {
      const amt = roundGbp(line.amountGbp);
      if (amt.lt(0)) {
        return err(
          new DomainError('NEGATIVE_JOURNAL_LINE', 'Journal amounts must be non-negative.', 400),
        );
      }
      if (line.side === 'DEBIT') debits = debits.plus(amt);
      else credits = credits.plus(amt);
    }
    if (!roundGbp(debits).equals(roundGbp(credits))) {
      return err(
        new DomainError(
          'UNBALANCED_LEDGER',
          `Double-entry invariant violated: DEBIT ${formatGbp(debits)} != CREDIT ${formatGbp(credits)}.`,
          500,
        ),
      );
    }
    return ok(undefined);
  }

  public recordOrderSettlement(
    input: RecordOrderSettlementInput,
    metadata: EventMetadata,
  ): Result<void> {
    if (this.state.settledOrderIds.includes(input.orderId)) {
      return ok(undefined);
    }

    const grossOrderTotal = roundGbp(
      input.subtotalGbp.plus(input.vatGbp).plus(input.deliveryFeeGbp),
    );
    const loyaltyDiscount = roundGbp(input.loyaltyDiscountGbp);
    const cashOrGatewayCollected = roundGbp(grossOrderTotal.minus(loyaltyDiscount));
    const commissionFee = roundGbp(input.subtotalGbp.mul(input.commissionRatePercent).div(100));
    const commissionVat = roundGbp(input.commissionVatGbp);
    const totalPlatformFee = roundGbp(commissionFee.plus(commissionVat));
    const isCashChannel = input.paymentMode === 'CASH' || input.paymentMode === 'COD';

    const lines: JournalLineSpec[] = [];
    if (cashOrGatewayCollected.gt(0)) {
      lines.push({
        accountCode: isCashChannel ? 'MERCHANT_CASH_CLEARING' : 'PLATFORM_GATEWAY_CLEARING',
        side: 'DEBIT',
        amountGbp: formatGbp(cashOrGatewayCollected),
        description: `Order ${input.orderId} funds collected via ${input.paymentMode}`,
      });
    }
    if (loyaltyDiscount.gt(0)) {
      lines.push({
        accountCode: 'LOYALTY_LIABILITY_REDEEMED',
        side: 'DEBIT',
        amountGbp: formatGbp(loyaltyDiscount),
        description: `Loyalty points applied on order ${input.orderId}`,
      });
    }

    if (isCashChannel) {
      if (cashOrGatewayCollected.gt(0)) {
        lines.push({
          accountCode: 'MERCHANT_CASH_CLEARING',
          side: 'CREDIT',
          amountGbp: formatGbp(cashOrGatewayCollected),
          description: 'Merchant cash collected directly on cash/COD order',
        });
      }
      if (totalPlatformFee.gt(0)) {
        lines.push({
          accountCode: 'MERCHANT_CASH_RECEIVABLE',
          side: 'DEBIT',
          amountGbp: formatGbp(totalPlatformFee),
          description: 'Commission owed by merchant on cash/COD order',
        });
      }
    } else {
      const merchantNetPayable = roundGbp(grossOrderTotal.minus(totalPlatformFee));
      lines.push({
        accountCode: 'MERCHANT_PAYABLE',
        side: 'CREDIT',
        amountGbp: formatGbp(merchantNetPayable),
        description: 'Net merchant payable from online/terminal order',
      });
    }

    if (commissionFee.gt(0)) {
      lines.push({
        accountCode: 'PLATFORM_COMMISSION_REVENUE',
        side: 'CREDIT',
        amountGbp: formatGbp(commissionFee),
        description: 'Platform commission net revenue',
      });
    }
    if (commissionVat.gt(0)) {
      lines.push({
        accountCode: 'UK_OUTPUT_VAT_PAYABLE',
        side: 'CREDIT',
        amountGbp: formatGbp(commissionVat),
        description: 'UK 20% VAT on platform commission',
      });
    }

    const balanced = FinancialLedgerAggregate.assertBalanced(lines);
    if (!balanced.ok) return balanced;

    this.raiseEvent<BillingSettlementRecordedPayload>(
      'BillingSettlementRecorded',
      {
        orderId: input.orderId,
        branchId: input.branchId,
        restaurantId: input.restaurantId,
        customerId: input.customerId,
        paymentMode: input.paymentMode,
        gatewayReference: input.gatewayReference,
        subtotalGbp: formatGbp(input.subtotalGbp),
        vatGbp: formatGbp(input.vatGbp),
        deliveryFeeGbp: formatGbp(input.deliveryFeeGbp),
        loyaltyDiscountGbp: formatGbp(loyaltyDiscount),
        commissionFeeGbp: formatGbp(commissionFee),
        commissionVatGbp: formatGbp(commissionVat),
        grossTotalGbp: formatGbp(grossOrderTotal),
        allowLoyaltyEarn: input.allowLoyaltyEarn,
        journalLines: lines,
      },
      metadata,
    );
    return ok(undefined);
  }

  protected apply(event: DomainEvent<unknown>): void {
    if (event.eventType === 'BillingSettlementRecorded') {
      const p = event.payload as BillingSettlementRecordedPayload;
      this.state.settledOrderIds.push(p.orderId);
      const totalFee = money(p.commissionFeeGbp).plus(money(p.commissionVatGbp));
      if (p.paymentMode === 'CASH' || p.paymentMode === 'COD') {
        this.state.cashCommissionReceivableGbp = formatGbp(
          money(this.state.cashCommissionReceivableGbp).plus(totalFee),
        );
      } else {
        const netPayable = money(p.grossTotalGbp).minus(totalFee);
        this.state.merchantPayableGbp = formatGbp(
          money(this.state.merchantPayableGbp).plus(netPayable),
        );
      }
    } else if (event.eventType === 'BillingRefundRecorded') {
      const p = event.payload as BillingRefundRecordedPayload;
      this.state.merchantPayableGbp = formatGbp(
        money(this.state.merchantPayableGbp).minus(money(p.refundAmountGbp)),
      );
    }
  }

  public get snapshot(): Readonly<FinancialLedgerState> {
    return this.state;
  }
}
