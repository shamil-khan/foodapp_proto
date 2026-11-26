import * as crypto from 'node:crypto';
import { OrderTable, sqlSelect, type UnitOfWork } from '@foodapp/db';
import Decimal from 'decimal.js';
import type { RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { formatGbp, money, roundGbp } from '@/core/domain/money';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { ReadRepository } from '@/core/infrastructure/read-repository';
import type { CartLineInput, CartStorePort } from '@/orders/application/cart-service';
import {
  type BranchRuntimePolicy,
  evaluatePromoCode,
  hydrateOrderLines,
  loadBranchPolicy,
  validateChannelCapability,
} from '@/orders/application/order-pricing-helpers';
import type { OrderPaymentPort } from '@/orders/application/payment-port';
import { computeAuthoritativeLineSnapshots, OrderAggregate } from '@/orders/domain/order-aggregate';
import type {
  OrderChannel,
  OrderLoyaltyScope,
  OrderPaymentMode,
  OrderStatus,
} from '@/orders/domain/order-events';
import type { OrderRepository } from '@/orders/infrastructure/order-repository';

export interface PreviewOrderCommand
  extends Command<
    Result<{
      readonly branchId: string;
      readonly subtotalGbp: string;
      readonly vatTotalGbp: string;
      readonly deliveryFeeGbp: string;
      readonly promoDiscountGbp: string;
      readonly totalAmountGbp: string;
      readonly allowLoyaltyEarn: boolean;
      readonly allowLoyaltyRedeem: boolean;
    }>
  > {
  readonly branchId: string;
  readonly orderSource: OrderChannel;
  readonly promoCode?: string;
  readonly items: readonly CartLineInput[];
}

export class PreviewOrderHandler
  implements
    CommandHandler<
      PreviewOrderCommand,
      Result<{
        readonly branchId: string;
        readonly subtotalGbp: string;
        readonly vatTotalGbp: string;
        readonly deliveryFeeGbp: string;
        readonly promoDiscountGbp: string;
        readonly totalAmountGbp: string;
        readonly allowLoyaltyEarn: boolean;
        readonly allowLoyaltyRedeem: boolean;
      }>
    >
{
  private readonly readRepo: ReadRepository;

  constructor(readRepo: ReadRepository) {
    this.readRepo = readRepo;
  }

  async execute(cmd: PreviewOrderCommand) {
    const dbReaderAdapter = {
      queryOne: this.readRepo.findOne.bind(this.readRepo),
      queryMany: this.readRepo.findMany.bind(this.readRepo),
      exists: this.readRepo.exists.bind(this.readRepo),
    };
    const branch = await loadBranchPolicy(dbReaderAdapter, cmd.branchId);
    if (!branch) return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));

    const hydrated = await hydrateOrderLines(dbReaderAdapter, branch, cmd.items);
    if (!hydrated.ok) return hydrated;

    const grossFood = hydrated.value.reduce((acc, l) => {
      const modSum = l.modifiers.reduce((mAcc, m) => mAcc.plus(m.extraPriceGbp), new Decimal(0));
      return acc.plus(l.unitPriceGbp.plus(modSum).mul(l.quantity));
    }, new Decimal(0));

    const promoRes = await evaluatePromoCode({
      db: dbReaderAdapter,
      restaurantId: branch.restaurantId,
      promoCode: cmd.promoCode,
      grossSubtotal: grossFood,
      now: new Date(),
    });
    if (!promoRes.ok) return promoRes;

    const deliveryFee =
      cmd.orderSource === 'ONLINE_DELIVERY' ? new Decimal('2.99') : new Decimal(0);
    const snap = computeAuthoritativeLineSnapshots({
      lines: hydrated.value,
      promoDiscountGbp: promoRes.value.promoDiscountGbp,
      deliveryFeeGbp: deliveryFee,
    });

    return ok({
      branchId: branch.id,
      subtotalGbp: formatGbp(snap.subtotalGbp),
      vatTotalGbp: formatGbp(snap.vatTotalGbp),
      deliveryFeeGbp: formatGbp(snap.deliveryFeeGbp),
      promoDiscountGbp: formatGbp(promoRes.value.promoDiscountGbp),
      totalAmountGbp: formatGbp(snap.totalAmountGbp),
      allowLoyaltyEarn: promoRes.value.allowLoyaltyEarn,
      allowLoyaltyRedeem: promoRes.value.allowLoyaltyRedeem,
    });
  }
}

export interface CheckoutOrderCommand
  extends Command<
    Result<{
      readonly orderId: string;
      readonly status: OrderStatus;
      readonly totalAmountGbp: string;
      readonly gatewayReference?: string;
    }>
  > {
  readonly branchId: string;
  readonly orderSource: OrderChannel;
  readonly paymentMode: OrderPaymentMode;
  readonly paymentToken?: string;
  readonly promoCode?: string;
  readonly loyaltyPointsToRedeem?: number;
  readonly loyaltyWalletScope?: OrderLoyaltyScope;
  readonly idempotencyKey?: string;
  readonly items?: readonly CartLineInput[];
}

export class CheckoutOrderHandler
  implements
    CommandHandler<
      CheckoutOrderCommand,
      Result<{
        readonly orderId: string;
        readonly status: OrderStatus;
        readonly totalAmountGbp: string;
        readonly gatewayReference?: string;
      }>
    >
{
  private readonly uow: UnitOfWork;
  private readonly orderRepo: OrderRepository;
  private readonly cartStore: CartStorePort;
  private readonly gateway: OrderPaymentPort;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    orderRepo: OrderRepository,
    cartStore: CartStorePort,
    gateway: OrderPaymentPort,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.orderRepo = orderRepo;
    this.cartStore = cartStore;
    this.gateway = gateway;
    this.request = request;
  }

  private async getBranchActiveCashExposureGbp(branchId: string): Promise<Decimal> {
    const oCols = OrderTable.cols;
    const q = sqlSelect(OrderTable)
      .select([
        oCols.totalAmount,
        oCols.paymentMethod,
      ])
      .whereEq(oCols.branchId, branchId)
      .activeOnly()
      .compile();
    const rows = await this.uow.queryMany(q);
    return rows
      .filter((r) => r.paymentMethod === 'CASH' || r.paymentMethod === 'COD')
      .reduce((acc, r) => acc.plus(new Decimal(r.totalAmount)), new Decimal(0));
  }

  private async assertCashCreditLimit(
    branch: BranchRuntimePolicy,
    paymentMode: OrderPaymentMode,
  ): Promise<Result<void>> {
    if (paymentMode !== 'CASH' && paymentMode !== 'COD') return ok(undefined);
    const activeCashExposure = await this.getBranchActiveCashExposureGbp(branch.id);
    if (activeCashExposure.gte(branch.maxReceivableCreditLimitGbp)) {
      return err(
        new DomainError(
          'CASH_CREDIT_LIMIT_EXCEEDED',
          'Cash/COD temporarily unavailable while merchant commission receivable limit is exceeded.',
          403,
        ),
      );
    }
    return ok(undefined);
  }

  private async captureOnlinePayment(
    order: OrderAggregate,
    cmd: CheckoutOrderCommand,
    restaurantId: string,
  ): Promise<Result<string | undefined>> {
    if (cmd.paymentMode !== 'ONLINE_GATEWAY' || !money(order.snapshot.totalAmountGbp).gt(0)) {
      return ok(undefined);
    }

    const charge = await this.gateway.captureCharge({
      orderId: order.id,
      amountGbp: money(order.snapshot.totalAmountGbp),
      currency: 'GBP',
      paymentToken: cmd.paymentToken ?? 'tok_ok',
      idempotencyKey: cmd.idempotencyKey ?? order.id,
    });

    if (charge.status !== 'CAPTURED') {
      order.cancelOrReject('CANCELLED', charge.message, {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId,
      });
      await this.orderRepo.save(order);
      return err(
        new DomainError(
          charge.status === 'DECLINED' ? 'PAYMENT_DECLINED' : 'GATEWAY_TIMEOUT',
          charge.message,
          charge.status === 'DECLINED' ? 402 : 504,
        ),
      );
    }

    order.confirmOnlinePaymentCaptured(charge.providerReference, {
      requestId: this.request.requestId,
      actorId: this.request.actorId,
      restaurantId,
    });
    await this.orderRepo.save(order);
    return ok(charge.providerReference);
  }

  private async resolveCheckoutCart(
    branchId: string,
    cmdItems?: readonly CartLineInput[],
    cmdPromoCode?: string,
  ): Promise<
    Result<{
      readonly lines: readonly CartLineInput[];
      readonly promoCode?: string;
    }>
  > {
    const stored = await this.cartStore.getCart(this.request.actorId, branchId);
    const lines = cmdItems && cmdItems.length > 0 ? cmdItems : (stored?.lines ?? []);
    if (lines.length === 0) {
      return err(new DomainError('EMPTY_CART', 'Cart is empty.', 400));
    }
    return ok({
      lines,
      promoCode: cmdPromoCode ?? stored?.promoCode,
    });
  }

  async execute(cmd: CheckoutOrderCommand): Promise<
    Result<{
      readonly orderId: string;
      readonly status: OrderStatus;
      readonly totalAmountGbp: string;
      readonly gatewayReference?: string;
    }>
  > {
    if (this.request.actorSource === 'ANONYMOUS') {
      return err(new DomainError('UNAUTHORIZED', 'Authenticated customer session required.', 401));
    }
    if (this.request.actorSource !== 'CUSTOMER') {
      return err(
        new DomainError(
          'FORBIDDEN',
          'Business staff accounts cannot place storefront food orders.',
          403,
        ),
      );
    }

    const branch = await loadBranchPolicy(this.uow, cmd.branchId);
    if (!branch) return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));

    const capCheck = validateChannelCapability(branch, cmd.orderSource, cmd.paymentMode);
    if (!capCheck.ok) return capCheck;

    const creditCheck = await this.assertCashCreditLimit(branch, cmd.paymentMode);
    if (!creditCheck.ok) return creditCheck;

    const cartRes = await this.resolveCheckoutCart(cmd.branchId, cmd.items, cmd.promoCode);
    if (!cartRes.ok) return cartRes;

    const hydrated = await hydrateOrderLines(this.uow, branch, cartRes.value.lines);
    if (!hydrated.ok) return hydrated;

    const grossFood = hydrated.value.reduce((acc, l) => {
      const modSum = l.modifiers.reduce((mAcc, m) => mAcc.plus(m.extraPriceGbp), new Decimal(0));
      return acc.plus(l.unitPriceGbp.plus(modSum).mul(l.quantity));
    }, new Decimal(0));

    const promoRes = await evaluatePromoCode({
      db: this.uow,
      restaurantId: branch.restaurantId,
      promoCode: cartRes.value.promoCode,
      grossSubtotal: grossFood,
      now: new Date(),
    });
    if (!promoRes.ok) return promoRes;

    const orderId = crypto.randomUUID();
    const pointsHeld = Math.max(0, cmd.loyaltyPointsToRedeem ?? 0);
    const loyaltyDiscount =
      pointsHeld > 0 ? roundGbp(new Decimal('0.01').mul(pointsHeld)) : new Decimal(0);
    const deliveryFee =
      cmd.orderSource === 'ONLINE_DELIVERY' ? new Decimal('2.99') : new Decimal(0);

    const aggRes = OrderAggregate.createOrder(
      orderId,
      {
        branchId: branch.id,
        restaurantId: branch.restaurantId,
        customerId: this.request.actorId,
        orderSource: cmd.orderSource,
        stateMachineCode: branch.stateMachineCode,
        paymentMode: cmd.paymentMode,
        requiresOnlineCapture: cmd.paymentMode === 'ONLINE_GATEWAY',
        idempotencyKey: cmd.idempotencyKey,
        lines: hydrated.value,
        promoDiscountGbp: promoRes.value.promoDiscountGbp,
        deliveryFeeGbp: deliveryFee,
        loyaltyPointsHeld: pointsHeld,
        loyaltyWalletScope: pointsHeld > 0 ? (cmd.loyaltyWalletScope ?? 'PLATFORM') : undefined,
        loyaltyDiscountGbp: loyaltyDiscount,
        allowLoyaltyEarn: promoRes.value.allowLoyaltyEarn,
        allowLoyaltyRedeem: promoRes.value.allowLoyaltyRedeem,
      },
      {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId: branch.restaurantId,
      },
    );
    if (!aggRes.ok) return aggRes;
    const order = aggRes.value;
    await this.orderRepo.save(order);
    const gwRes = await this.captureOnlinePayment(order, cmd, branch.restaurantId);
    if (!gwRes.ok) return gwRes;
    await this.cartStore.clearCart(this.request.actorId, cmd.branchId);
    return ok({
      orderId,
      status: order.snapshot.status,
      totalAmountGbp: order.snapshot.totalAmountGbp,
      gatewayReference: gwRes.value,
    });
  }
}
