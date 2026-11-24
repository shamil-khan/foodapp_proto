import type { DomainEvent } from '@/core/domain/domain-event';

export type PaymentChannelMode =
  | 'CASH'
  | 'COD'
  | 'CARD_TERMINAL'
  | 'ONLINE_GATEWAY'
  | 'LOYALTY_POINTS';
export type AccountSide = 'DEBIT' | 'CREDIT';

export interface JournalLineSpec {
  readonly accountCode: string;
  readonly side: AccountSide;
  readonly amountGbp: string;
  readonly description: string;
}

export interface BillingSettlementRecordedPayload {
  readonly orderId: string;
  readonly branchId: string;
  readonly restaurantId: string;
  readonly customerId?: string;
  readonly paymentMode: PaymentChannelMode;
  readonly gatewayReference?: string;
  readonly subtotalGbp: string;
  readonly vatGbp: string;
  readonly deliveryFeeGbp: string;
  readonly loyaltyDiscountGbp: string;
  readonly commissionFeeGbp: string;
  readonly commissionVatGbp: string;
  readonly grossTotalGbp: string;
  readonly allowLoyaltyEarn: boolean;
  readonly journalLines: readonly JournalLineSpec[];
}

export interface BillingRefundRecordedPayload {
  readonly orderId: string;
  readonly branchId: string;
  readonly restaurantId: string;
  readonly refundAmountGbp: string;
  readonly gatewayRefundReference?: string;
  readonly reason: string;
  readonly journalLines: readonly JournalLineSpec[];
}

export interface MerchantSettlementCreatedPayload {
  readonly settlementId: string;
  readonly restaurantId: string;
  readonly grossOnlinePayableGbp: string;
  readonly cashCommissionReceivableGbp: string;
  readonly loyaltyFeeOffsetGbp: string;
  readonly commissionVatGbp: string;
  readonly netPayoutGbp: string;
}

export interface MerchantLoyaltyOffsetRequestedPayload {
  readonly settlementId: string;
  readonly restaurantId: string;
  readonly maxOffsetGbp: string;
  readonly markPaidReference?: string;
}

export type BillingSettlementRecordedEvent = DomainEvent<BillingSettlementRecordedPayload>;
export type BillingRefundRecordedEvent = DomainEvent<BillingRefundRecordedPayload>;
export type MerchantSettlementCreatedEvent = DomainEvent<MerchantSettlementCreatedPayload>;
export type MerchantLoyaltyOffsetRequestedEvent =
  DomainEvent<MerchantLoyaltyOffsetRequestedPayload>;
