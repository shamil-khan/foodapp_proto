import Decimal from 'decimal.js';
import {
  allocateLineVatWithRemainder,
  type LineVatAllocation,
  type LineVatInput,
  roundGbp,
} from '@/core/domain/money';

export interface UkVatBreakdown {
  readonly lines: readonly LineVatAllocation[];
  readonly totalNetGbp: Decimal;
  readonly totalVatGbp: Decimal;
  readonly totalGrossGbp: Decimal;
}

export interface VatCalculationStrategy {
  readonly code: string;
  calculateOrderVat(lines: readonly LineVatInput[]): UkVatBreakdown;
  calculateCommissionVat(commissionNetGbp: Decimal): Decimal;
}

/**
 * UK Disclosed Agent VAT Strategy:
 * - Food lines use per-item UK VAT rate (20% standard hot/dine-in vs 0% zero-rated cold takeaway).
 * - Platform commission attracts 20% UK Standard Rate VAT.
 */
export class UkStandardVatStrategy implements VatCalculationStrategy {
  public readonly code = 'UK_STANDARD_20';
  private static readonly COMMISSION_VAT_RATE = new Decimal('0.20');

  calculateOrderVat(lines: readonly LineVatInput[]): UkVatBreakdown {
    const allocated = allocateLineVatWithRemainder(lines);
    return {
      lines: allocated.lines,
      totalNetGbp: allocated.totalNet,
      totalVatGbp: allocated.totalVat,
      totalGrossGbp: allocated.totalGross,
    };
  }

  calculateCommissionVat(commissionNetGbp: Decimal): Decimal {
    return roundGbp(commissionNetGbp.mul(UkStandardVatStrategy.COMMISSION_VAT_RATE));
  }
}
