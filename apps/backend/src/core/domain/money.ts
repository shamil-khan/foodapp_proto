import Decimal from 'decimal.js';

// Configure global arbitrary-precision financial standard for UK GBP (£)
Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
});

export type MoneyInput = Decimal.Value;

export function money(value: MoneyInput): Decimal {
  return new Decimal(value);
}

export function roundGbp(value: MoneyInput): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function formatGbp(value: MoneyInput): string {
  return roundGbp(value).toFixed(2);
}

export interface LineVatInput {
  readonly lineId: string;
  readonly netAmount: MoneyInput;
  readonly vatRatePercent: MoneyInput;
}

export interface LineVatAllocation {
  readonly lineId: string;
  readonly netAmount: Decimal;
  readonly vatAmount: Decimal;
  readonly grossAmount: Decimal;
}

/**
 * Calculates exact UK VAT per line using ROUND_HALF_UP and deterministically allocates
 * any £0.01 rounding remainder to the largest net line item.
 */
export function allocateLineVatWithRemainder(lines: readonly LineVatInput[]): {
  readonly lines: LineVatAllocation[];
  readonly totalNet: Decimal;
  readonly totalVat: Decimal;
  readonly totalGross: Decimal;
} {
  if (lines.length === 0) {
    const zero = roundGbp(0);
    return {
      lines: [],
      totalNet: zero,
      totalVat: zero,
      totalGross: zero,
    };
  }

  let unroundedVatSum = new Decimal(0);
  let roundedVatSum = new Decimal(0);
  let largestIdx = 0;

  const computed = lines.map((line, idx) => {
    const net = roundGbp(line.netAmount);
    const largestNet = roundGbp(lines[largestIdx]?.netAmount ?? 0);
    if (net.gt(largestNet)) {
      largestIdx = idx;
    }
    const rate = new Decimal(line.vatRatePercent).div(100);
    const rawVat = net.mul(rate);
    const roundedVat = roundGbp(rawVat);

    unroundedVatSum = unroundedVatSum.plus(rawVat);
    roundedVatSum = roundedVatSum.plus(roundedVat);

    return {
      lineId: line.lineId,
      netAmount: net,
      vatAmount: roundedVat,
      grossAmount: net.plus(roundedVat),
    };
  });

  const targetVat = roundGbp(unroundedVatSum);
  const pennyDiff = targetVat.minus(roundedVatSum);

  if (!pennyDiff.isZero() && computed[largestIdx]) {
    const target = computed[largestIdx];
    const adjustedVat = roundGbp(target.vatAmount.plus(pennyDiff));
    computed[largestIdx] = {
      ...target,
      vatAmount: adjustedVat,
      grossAmount: target.netAmount.plus(adjustedVat),
    };
  }

  const totalNet = roundGbp(computed.reduce((acc, l) => acc.plus(l.netAmount), new Decimal(0)));
  const totalVat = roundGbp(computed.reduce((acc, l) => acc.plus(l.vatAmount), new Decimal(0)));
  const totalGross = roundGbp(totalNet.plus(totalVat));

  return {
    lines: computed,
    totalNet,
    totalVat,
    totalGross,
  };
}
