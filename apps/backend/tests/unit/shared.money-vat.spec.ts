import { describe, expect, it } from 'vitest';
import { allocateLineVatWithRemainder, formatGbp, money, roundGbp } from '@/core/domain/money';

describe('shared.money-vat — Exact GBP & UK VAT Arithmetic (decimal.js)', () => {
  it('rounds half-up to 2 decimal places without IEEE-754 float drift', () => {
    const sum = roundGbp(money('0.10').plus('0.20'));
    expect(formatGbp(sum)).toBe('0.30');

    expect(formatGbp(roundGbp('10.005'))).toBe('10.01');
    expect(formatGbp(roundGbp('10.004'))).toBe('10.00');
  });

  it('computes UK 20% standard VAT on hot food and 0% zero-rated VAT on cold takeaway', () => {
    const vatRes = allocateLineVatWithRemainder([
      {
        lineId: 'hot-1',
        netAmount: '12.50',
        vatRatePercent: '20.00',
      },
      {
        lineId: 'cold-1',
        netAmount: '8.99',
        vatRatePercent: '0.00',
      },
    ]);

    expect(formatGbp(vatRes.lines[0]?.vatAmount ?? 0)).toBe('2.50');
    expect(formatGbp(vatRes.lines[1]?.vatAmount ?? 0)).toBe('0.00');
    expect(formatGbp(vatRes.totalVat)).toBe('2.50');
    expect(formatGbp(vatRes.totalGross)).toBe('23.99');
  });

  it('allocates odd penny remainders deterministically to the largest line', () => {
    const oddVat = allocateLineVatWithRemainder([
      {
        lineId: 'line-largest',
        netAmount: '1.02',
        vatRatePercent: '20.00',
      },
      {
        lineId: 'line-small-1',
        netAmount: '1.01',
        vatRatePercent: '20.00',
      },
      {
        lineId: 'line-small-2',
        netAmount: '1.01',
        vatRatePercent: '20.00',
      },
    ]);

    // Total net = 3.04 -> raw VAT = 0.608 -> target 0.61; individual rounded = 0.20 * 3 = 0.60 -> +0.01 to largest
    expect(oddVat.lines.map((l) => formatGbp(l.vatAmount))).toEqual([
      '0.21',
      '0.20',
      '0.20',
    ]);
    expect(formatGbp(oddVat.totalVat)).toBe('0.61');
  });
});
