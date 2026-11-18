import { AggregateRoot } from '@/core/domain/aggregate-root';
import type { DomainEvent, EventMetadata } from '@/core/domain/domain-event';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export interface DoubleEntryLine {
  readonly entityName: string;
  readonly creditAmount: number;
  readonly debitAmount: number;
  readonly description: string;
}

export interface SettlementRecordedPayload {
  readonly orderId: string;
  readonly restaurantId: string;
  readonly grossTotal: number;
  readonly platformFeeRate: number;
  readonly entries: readonly DoubleEntryLine[];
}

export interface LedgerAggregateState {
  orderId: string;
  restaurantId: string;
  isSettled: boolean;
  totalCredits: number;
  totalDebits: number;
  entries: DoubleEntryLine[];
}

const INITIAL_STATE: LedgerAggregateState = {
  orderId: '',
  restaurantId: '',
  isSettled: false,
  totalCredits: 0,
  totalDebits: 0,
  entries: [],
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export class FinancialLedgerAggregate extends AggregateRoot<LedgerAggregateState> {
  private constructor(id: string, state: LedgerAggregateState = structuredClone(INITIAL_STATE)) {
    super(id, 'FinancialLedgerAggregate', state);
  }

  public static empty(id: string): FinancialLedgerAggregate {
    return new FinancialLedgerAggregate(id);
  }

  public static recordOrderSettlement(
    id: string,
    params: {
      orderId: string;
      restaurantId: string;
      subtotal: number;
      vatTotal: number;
      tipAmount?: number;
      totalAmount: number;
      platformFeeRate: number;
    },
    metadata: EventMetadata,
  ): Result<FinancialLedgerAggregate> {
    if (params.totalAmount <= 0) {
      return err(
        new DomainError('INVALID_SETTLEMENT', 'Settlement total must be greater than zero.'),
      );
    }

    if (params.platformFeeRate < 0 || params.platformFeeRate > 100) {
      return err(
        new DomainError('INVALID_FEE_RATE', 'Platform fee rate must be between 0% and 100%.'),
      );
    }

    const cleanTotal = round2(params.totalAmount);
    const cleanSubtotal = round2(params.subtotal);
    const cleanVat = round2(params.vatTotal);
    const cleanTip = round2(params.tipAmount ?? 0);

    // 1. Platform commission is calculated strictly on net food/drink subtotal (never on VAT or staff tips)
    const platformCommission = round2(cleanSubtotal * (params.platformFeeRate / 100));

    // 2. Restaurant receives net subtotal minus commission, plus 100% of customer tips
    const restaurantNet = round2(cleanSubtotal - platformCommission + cleanTip);

    // 3. Verify double-entry accounting balance (Total Debits === Total Credits)
    const totalCredits = round2(restaurantNet + platformCommission + cleanVat);
    if (totalCredits !== cleanTotal) {
      return err(
        new DomainError(
          'UNBALANCED_LEDGER',
          `Double-entry mismatch: debits (${cleanTotal}) do not equal credits (${totalCredits}).`,
        ),
      );
    }

    const entries: DoubleEntryLine[] = [
      {
        entityName: 'GATEWAY_CLEARING',
        creditAmount: 0,
        debitAmount: cleanTotal,
        description: `Gross payment captured for Order ${params.orderId}`,
      },
      {
        entityName: `RESTAURANT_${params.restaurantId}`,
        creditAmount: restaurantNet,
        debitAmount: 0,
        description:
          cleanTip > 0
            ? `Net merchant payout after ${params.platformFeeRate}% fee (includes £${cleanTip.toFixed(2)} tip)`
            : `Net merchant payout after ${params.platformFeeRate}% platform fee`,
      },
    ];

    if (platformCommission > 0) {
      entries.push({
        entityName: 'PLATFORM_REVENUE',
        creditAmount: platformCommission,
        debitAmount: 0,
        description: `Platform commission (${params.platformFeeRate}%)`,
      });
    }

    if (cleanVat > 0) {
      entries.push({
        entityName: `HMRC_VAT_${params.restaurantId}`,
        creditAmount: cleanVat,
        debitAmount: 0,
        description: 'UK Output VAT reserve (20%)',
      });
    }

    const ledger = new FinancialLedgerAggregate(id);
    ledger.raiseEvent<SettlementRecordedPayload>(
      'SettlementRecorded',
      {
        orderId: params.orderId,
        restaurantId: params.restaurantId,
        grossTotal: cleanTotal,
        platformFeeRate: params.platformFeeRate,
        entries,
      },
      metadata,
    );

    return ok(ledger);
  }

  protected apply(event: DomainEvent<unknown>): void {
    if (event.eventType === 'SettlementRecorded') {
      const p = event.payload as unknown as SettlementRecordedPayload;
      this.state.orderId = p.orderId;
      this.state.restaurantId = p.restaurantId;
      this.state.isSettled = true;
      this.state.entries = [
        ...p.entries,
      ];
      this.state.totalCredits = round2(p.entries.reduce((sum, e) => sum + e.creditAmount, 0));
      this.state.totalDebits = round2(p.entries.reduce((sum, e) => sum + e.debitAmount, 0));
    }
  }

  public get snapshot(): Readonly<LedgerAggregateState> {
    return this.state;
  }

  public shouldTakeMemento(): boolean {
    return this._version > 0 && this._version % 5 === 0;
  }
}
