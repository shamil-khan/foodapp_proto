export interface VatCalculationResult {
  readonly netAmount: number;
  readonly vatAmount: number;
  readonly grossAmount: number;
  readonly appliedRate: number;
}

export interface UkVatStrategy {
  readonly rateName: string;
  calculate(netAmount: number): VatCalculationResult;
}

export class StandardUkVatStrategy implements UkVatStrategy {
  readonly rateName = 'UK_STANDARD_20';
  private static readonly RATE = 0.2;

  calculate(netAmount: number): VatCalculationResult {
    const cleanNet = Number(netAmount.toFixed(2));
    const vatAmount = Number((cleanNet * StandardUkVatStrategy.RATE).toFixed(2));
    return {
      netAmount: cleanNet,
      vatAmount,
      grossAmount: Number((cleanNet + vatAmount).toFixed(2)),
      appliedRate: 20,
    };
  }
}

export class ZeroRatedUkVatStrategy implements UkVatStrategy {
  readonly rateName = 'UK_ZERO_RATED_0';

  calculate(netAmount: number): VatCalculationResult {
    const cleanNet = Number(netAmount.toFixed(2));
    return {
      netAmount: cleanNet,
      vatAmount: 0,
      grossAmount: cleanNet,
      appliedRate: 0,
    };
  }
}

export function resolveUkVatStrategy(vatRatePercent: number): UkVatStrategy {
  return vatRatePercent === 0 ? new ZeroRatedUkVatStrategy() : new StandardUkVatStrategy();
}
