import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { FinancialLedgerAggregate } from '@/billing/domain/billing-aggregate';
import type { BillingSettlementRecordedPayload } from '@/billing/domain/billing-events';
import { money } from '@/core/domain/money';

describe('billing.double-entry — Balanced Debits/Credits & UK Commission VAT', () => {
  it('maintains SUM(debit) === SUM(credit) for ONLINE_GATEWAY with loyalty discount subsidy', () => {
    const ledger = FinancialLedgerAggregate.create('rest-uk-1');
    const res = ledger.recordOrderSettlement(
      {
        orderId: 'ord-uk-100',
        branchId: 'branch-uk-1',
        restaurantId: 'rest-uk-1',
        customerId: 'cust-uk-1',
        paymentMode: 'ONLINE_GATEWAY',
        subtotalGbp: new Decimal('30.00'),
        vatGbp: new Decimal('6.00'),
        deliveryFeeGbp: new Decimal('2.50'),
        loyaltyDiscountGbp: new Decimal('3.00'),
        commissionRatePercent: new Decimal('15.00'),
        commissionVatGbp: new Decimal('0.90'),
        allowLoyaltyEarn: true,
      },
      {
        actorId: 'system',
        restaurantId: 'rest-uk-1',
      },
    );

    expect(res.ok).toBe(true);
    const events = ledger.pullDomainEvents();
    expect(events).toHaveLength(1);

    const payload = events[0]?.payload as BillingSettlementRecordedPayload;
    let totalDebit = money(0);
    let totalCredit = money(0);
    for (const line of payload.journalLines) {
      if (line.side === 'DEBIT') totalDebit = totalDebit.plus(line.amountGbp);
      if (line.side === 'CREDIT') totalCredit = totalCredit.plus(line.amountGbp);
    }

    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
    expect(ledger.snapshot.merchantPayableGbp).toBe('33.10');
  });

  it('posts balanced CASH_COMMISSION_RECEIVABLE entries on CASH orders', () => {
    const ledger = FinancialLedgerAggregate.create('rest-uk-2');
    const res = ledger.recordOrderSettlement(
      {
        orderId: 'ord-uk-200',
        branchId: 'branch-uk-2',
        restaurantId: 'rest-uk-2',
        paymentMode: 'CASH',
        subtotalGbp: new Decimal('20.00'),
        vatGbp: new Decimal('4.00'),
        deliveryFeeGbp: new Decimal('0.00'),
        loyaltyDiscountGbp: new Decimal('0.00'),
        commissionRatePercent: new Decimal('12.50'),
        commissionVatGbp: new Decimal('0.50'),
        allowLoyaltyEarn: false,
      },
      {
        actorId: 'system',
        restaurantId: 'rest-uk-2',
      },
    );

    expect(res.ok).toBe(true);
    const events = ledger.pullDomainEvents();
    const payload = events[0]?.payload as BillingSettlementRecordedPayload;
    let totalDebit = money(0);
    let totalCredit = money(0);
    for (const line of payload.journalLines) {
      if (line.side === 'DEBIT') totalDebit = totalDebit.plus(line.amountGbp);
      if (line.side === 'CREDIT') totalCredit = totalCredit.plus(line.amountGbp);
    }

    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
    expect(ledger.snapshot.cashCommissionReceivableGbp).toBe('3.00');
  });
});
