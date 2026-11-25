import * as crypto from 'node:crypto';
import {
  BranchMenuOverrideTable,
  CategoryTable,
  type DbReader,
  ItemModifierTable,
  type KdsRoutingTarget,
  MenuItemTable,
  OrderTable,
  PromotionTable,
  RestaurantBranchTable,
  sqlSelect,
  type UnitOfWork,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { formatGbp, money, roundGbp } from '@/core/domain/money';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { ReadRepository } from '@/core/infrastructure/read-repository';
import type { CartLineInput, CartStorePort } from '@/orders/application/cart-service';
import type { DeliveryProviderPort } from '@/orders/application/delivery-provider-port';
import type { OrderPaymentPort } from '@/orders/application/payment-port';
import {
  computeAuthoritativeLineSnapshots,
  type HydratedCartLineInput,
  OrderAggregate,
} from '@/orders/domain/order-aggregate';
import type {
  OrderChannel,
  OrderLoyaltyScope,
  OrderPaymentMode,
  OrderStateMachineCode,
  OrderStatus,
} from '@/orders/domain/order-events';
import { type KdsTicketOutput, KdsTicketVisitor } from '@/orders/domain/order-visitor';
import type { OrderRepository } from '@/orders/infrastructure/order-repository';

interface BranchRuntimePolicy {
  readonly id: string;
  readonly restaurantId: string;
  readonly operationalStatus: string;
  readonly isActive: boolean;
  readonly supportsDineIn: boolean;
  readonly supportsTakeaway: boolean;
  readonly supportsPlatformDelivery: boolean;
  readonly stateMachineCode: OrderStateMachineCode;
  readonly deliveryMode: string;
  readonly deliveryProviderCode: string | null;
  readonly postcodeSector: string;
  readonly paymentCapabilities: Record<string, string[]>;
  readonly maxReceivableCreditLimitGbp: Decimal;
}

async function loadBranchPolicy(
  db: DbReader,
  branchId: string,
): Promise<BranchRuntimePolicy | null> {
  const bCols = RestaurantBranchTable.cols;
  const q = sqlSelect(RestaurantBranchTable).whereEq(bCols.id, branchId).activeOnly().compile();
  const row = await db.queryOne(q);
  if (!row) return null;

  return {
    id: row.id,
    restaurantId: row.restaurantId,
    operationalStatus: row.operationalStatus,
    isActive: row.isActive,
    supportsDineIn: row.supportsDineIn,
    supportsTakeaway: row.supportsTakeaway,
    supportsPlatformDelivery: row.supportsPlatformDelivery,
    stateMachineCode: row.stateMachineCode as OrderStateMachineCode,
    deliveryMode: row.deliveryMode,
    deliveryProviderCode: row.deliveryProviderCode,
    postcodeSector: row.postcodeSector,
    paymentCapabilities: (row.paymentCapabilities ?? {}) as Record<string, string[]>,
    maxReceivableCreditLimitGbp: new Decimal(row.maxReceivableCreditLimitGbp ?? '500.00'),
  };
}

function validateChannelCapability(
  branch: BranchRuntimePolicy,
  orderSource: OrderChannel,
  paymentMode: OrderPaymentMode,
): Result<void> {
  if (!branch.isActive || branch.operationalStatus !== 'OPEN') {
    return err(
      new DomainError(
        'BRANCH_NOT_ACCEPTING_ORDERS',
        `Branch is currently ${branch.operationalStatus} and cannot accept orders.`,
        409,
      ),
    );
  }

  if (orderSource === 'DINE_IN' && !branch.supportsDineIn) {
    return err(new DomainError('CHANNEL_DISABLED', 'Branch does not support dine-in orders.', 400));
  }
  if (orderSource === 'TAKEAWAY' && !branch.supportsTakeaway) {
    return err(
      new DomainError('CHANNEL_DISABLED', 'Branch does not support takeaway orders.', 400),
    );
  }
  if (orderSource === 'ONLINE_DELIVERY' && !branch.supportsPlatformDelivery) {
    return err(
      new DomainError('CHANNEL_DISABLED', 'Branch does not support platform delivery.', 400),
    );
  }

  const capKey = orderSource === 'ONLINE_DELIVERY' ? 'DELIVERY' : orderSource;
  const allowedModes = branch.paymentCapabilities[capKey] ?? [];
  if (allowedModes.length > 0 && !allowedModes.includes(paymentMode)) {
    return err(
      new DomainError(
        'PAYMENT_MODE_UNSUPPORTED',
        `Payment mode ${paymentMode} is not enabled for ${orderSource} on this branch.`,
        400,
      ),
    );
  }

  return ok(undefined);
}

async function resolveItemModifiers(
  db: DbReader,
  menuItemId: string,
  modifierIds?: readonly string[],
): Promise<
  {
    modifierId: string;
    name: string;
    extraPriceGbp: Decimal;
  }[]
> {
  if (!modifierIds || modifierIds.length === 0) return [];
  const modCols = ItemModifierTable.cols;
  const modQ = sqlSelect(ItemModifierTable)
    .select([
      modCols.id,
      modCols.name,
      modCols.extraPrice,
    ])
    .whereIn(modCols.id, modifierIds)
    .whereEq(modCols.menuItemId, menuItemId)
    .activeOnly()
    .compile();
  const modRows = await db.queryMany(modQ);
  return modRows.map((m) => ({
    modifierId: m.id,
    name: m.name,
    extraPriceGbp: new Decimal(m.extraPrice),
  }));
}

async function hydrateSingleOrderLine(
  db: DbReader,
  branch: BranchRuntimePolicy,
  item: CartLineInput,
  overrideMap: Map<
    string,
    {
      menuItemId: string;
      isIncluded: boolean;
      isAvailable: boolean;
      priceOverride: string | null;
    }
  >,
): Promise<Result<HydratedCartLineInput>> {
  const mCols = MenuItemTable.cols;
  const cCols = CategoryTable.cols;

  const mQ = sqlSelect(MenuItemTable)
    .whereEq(mCols.id, item.menuItemId)
    .whereEq(mCols.isActive, true)
    .activeOnly()
    .compile();
  const menuRow = await db.queryOne(mQ);
  if (!menuRow) {
    return err(
      new DomainError('ITEM_NOT_FOUND', `Menu item ${item.menuItemId} is unavailable.`, 404),
    );
  }
  const catQ = sqlSelect(CategoryTable)
    .select([
      cCols.restaurantId,
    ])
    .whereEq(cCols.id, menuRow.categoryId)
    .activeOnly()
    .compile();
  const catRow = await db.queryOne(catQ);
  if (catRow?.restaurantId !== branch.restaurantId) {
    return err(
      new DomainError(
        'TENANT_FORBIDDEN',
        `Menu item ${item.menuItemId} does not belong to this brand.`,
        403,
      ),
    );
  }

  if (menuRow.branchId !== null && menuRow.branchId !== branch.id) {
    return err(
      new DomainError(
        'ITEM_BRANCH_RESTRICTED',
        `Menu item ${item.menuItemId} is restricted to another branch.`,
        403,
      ),
    );
  }

  const ov = overrideMap.get(menuRow.id);
  if (ov && (!ov.isIncluded || !ov.isAvailable)) {
    return err(
      new DomainError(
        'ITEM_UNAVAILABLE_AT_BRANCH',
        `Menu item ${menuRow.name} is unavailable at this branch.`,
        400,
      ),
    );
  }

  const effectivePrice = new Decimal(ov?.priceOverride ?? menuRow.basePrice);
  const resolvedMods = await resolveItemModifiers(db, item.menuItemId, item.modifierIds);

  return ok({
    lineId: crypto.randomUUID(),
    menuItemId: menuRow.id,
    itemName: menuRow.name,
    quantity: item.quantity,
    unitPriceGbp: effectivePrice,
    vatRatePercent: new Decimal(menuRow.vatRate),
    allergenFlags: menuRow.allergenFlags ?? [],
    kdsTarget: menuRow.kdsTarget as KdsRoutingTarget,
    modifiers: resolvedMods,
  });
}

async function hydrateOrderLines(
  db: DbReader,
  branch: BranchRuntimePolicy,
  items: readonly CartLineInput[],
): Promise<Result<HydratedCartLineInput[]>> {
  const oCols = BranchMenuOverrideTable.cols;
  const overrideQ = sqlSelect(BranchMenuOverrideTable)
    .select([
      oCols.menuItemId,
      oCols.isIncluded,
      oCols.isAvailable,
      oCols.priceOverride,
    ])
    .whereEq(oCols.branchId, branch.id)
    .activeOnly()
    .compile();
  const overrides = await db.queryMany(overrideQ);
  const overrideMap = new Map(
    overrides.map((o) => [
      o.menuItemId,
      o,
    ]),
  );

  const hydrated: HydratedCartLineInput[] = [];
  for (const item of items) {
    const lineRes = await hydrateSingleOrderLine(db, branch, item, overrideMap);
    if (!lineRes.ok) return lineRes;
    hydrated.push(lineRes.value);
  }
  return ok(hydrated);
}

async function evaluatePromoCode(params: {
  readonly db: DbReader;
  readonly restaurantId: string;
  readonly promoCode?: string;
  readonly grossSubtotal: Decimal;
  readonly now: Date;
}): Promise<
  Result<{
    readonly promoDiscountGbp: Decimal;
    readonly allowLoyaltyEarn: boolean;
    readonly allowLoyaltyRedeem: boolean;
  }>
> {
  if (!params.promoCode?.trim()) {
    return ok({
      promoDiscountGbp: new Decimal(0),
      allowLoyaltyEarn: true,
      allowLoyaltyRedeem: true,
    });
  }

  const pCols = PromotionTable.cols;
  const q = sqlSelect(PromotionTable)
    .whereEq(pCols.promoCode, params.promoCode.trim().toUpperCase())
    .activeOnly()
    .compile();
  const promo = await params.db.queryOne(q);
  if (!promo) {
    return err(new DomainError('INVALID_PROMO', 'Promotion code not found.', 404));
  }
  if (promo.restaurantId && promo.restaurantId !== params.restaurantId) {
    return err(new DomainError('INVALID_PROMO', 'Promotion does not apply to this brand.', 403));
  }
  if (params.now < new Date(promo.startDate) || params.now > new Date(promo.endDate)) {
    return err(new DomainError('PROMO_EXPIRED', 'Promotion code is outside active dates.', 400));
  }
  const dayOfWeek = params.now.getUTCDay();
  if (Array.isArray(promo.validDaysOfWeek) && !promo.validDaysOfWeek.includes(dayOfWeek)) {
    return err(new DomainError('PROMO_DAY_RESTRICTED', 'Promotion is not valid today.', 400));
  }
  const minSub = new Decimal(promo.minSubtotal);
  if (params.grossSubtotal.lt(minSub)) {
    return err(
      new DomainError(
        'PROMO_MIN_SUBTOTAL',
        `Minimum order subtotal of £${formatGbp(minSub)} required.`,
        400,
      ),
    );
  }

  const val = new Decimal(promo.discountValue);
  let discount =
    promo.discountType === 'PERCENTAGE' ? roundGbp(params.grossSubtotal.mul(val).div(100)) : val;
  if (promo.maxDiscount !== null) {
    discount = Decimal.min(discount, new Decimal(promo.maxDiscount));
  }

  return ok({
    promoDiscountGbp: roundGbp(discount),
    allowLoyaltyEarn: promo.allowLoyaltyEarn,
    allowLoyaltyRedeem: promo.allowLoyaltyRedeem,
  });
}

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
    // Capture online gateway payment outside DB transaction so external I/O never holds locks
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
    if (this.request.actorSource !== 'GLOBAL_USER') {
      return err(new DomainError('UNAUTHORIZED', 'Authenticated customer session required.', 401));
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

export interface PlacePosOrderCommand
  extends Command<
    Result<{
      readonly orderId: string;
      readonly kdsTickets: KdsTicketOutput;
    }>
  > {
  readonly restaurantId?: string;
  readonly diningTableId?: string;
  readonly customerId?: string;
  readonly orderSource: OrderChannel;
  readonly items: readonly CartLineInput[];
}

export class PlacePosOrderHandler
  implements
    CommandHandler<
      PlacePosOrderCommand,
      Result<{
        readonly orderId: string;
        readonly kdsTickets: KdsTicketOutput;
      }>
    >
{
  private readonly uow: UnitOfWork;
  private readonly orderRepo: OrderRepository;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    orderRepo: OrderRepository,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.orderRepo = orderRepo;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: PlacePosOrderCommand): Promise<
    Result<{
      readonly orderId: string;
      readonly kdsTickets: KdsTicketOutput;
    }>
  > {
    const branchId = this.request.branchId;
    if (!branchId) {
      return err(new DomainError('MISSING_BRANCH', 'Active branch session required.', 403));
    }
    const access = this.authz.assertBranchAccess(branchId, 'orders:place');
    if (!access.ok) return access;

    const branch = await loadBranchPolicy(this.uow, branchId);
    if (!branch) return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));

    const hydrated = await hydrateOrderLines(this.uow, branch, cmd.items);
    if (!hydrated.ok) return hydrated;

    const orderId = crypto.randomUUID();
    const aggRes = OrderAggregate.createOrder(
      orderId,
      {
        branchId: branch.id,
        restaurantId: branch.restaurantId,
        customerId: cmd.customerId,
        diningTableId: cmd.diningTableId,
        orderSource: cmd.orderSource,
        stateMachineCode: branch.stateMachineCode,
        paymentMode: 'CARD_TERMINAL',
        requiresOnlineCapture: false,
        lines: hydrated.value,
      },
      {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId: branch.restaurantId,
      },
    );
    if (!aggRes.ok) return aggRes;

    await this.orderRepo.save(aggRes.value);
    const kdsTickets = aggRes.value.accept(new KdsTicketVisitor()) as KdsTicketOutput;
    return ok({
      orderId,
      kdsTickets,
    });
  }
}

export interface TransitionOrderStatusCommand
  extends Command<
    Result<{
      readonly orderId: string;
      readonly status: OrderStatus;
      readonly rowVersion: number;
      readonly externalDeliveryId?: string;
    }>
  > {
  readonly orderId: string;
  readonly toStatus: OrderStatus;
  readonly expectedRowVersion?: number;
  readonly reason?: string;
}

export class TransitionOrderStatusHandler
  implements
    CommandHandler<
      TransitionOrderStatusCommand,
      Result<{
        readonly orderId: string;
        readonly status: OrderStatus;
        readonly rowVersion: number;
        readonly externalDeliveryId?: string;
      }>
    >
{
  private readonly uow: UnitOfWork;
  private readonly orderRepo: OrderRepository;
  private readonly deliveryProvider: DeliveryProviderPort;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    orderRepo: OrderRepository,
    deliveryProvider: DeliveryProviderPort,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.orderRepo = orderRepo;
    this.deliveryProvider = deliveryProvider;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: TransitionOrderStatusCommand): Promise<
    Result<{
      readonly orderId: string;
      readonly status: OrderStatus;
      readonly rowVersion: number;
      readonly externalDeliveryId?: string;
    }>
  > {
    const order = await this.orderRepo.findById(cmd.orderId);
    if (!order) return err(new DomainError('ORDER_NOT_FOUND', 'Order not found.', 404));

    if (this.request.actorSource === 'GLOBAL_USER' && !this.authz.isPlatformAdmin()) {
      if (order.snapshot.customerId !== this.request.actorId || cmd.toStatus !== 'CANCELLED') {
        return err(
          new DomainError('FORBIDDEN', 'Customers may only cancel their own active orders.', 403),
        );
      }
    } else if (this.request.actorSource === 'POS_STAFF') {
      const access = this.authz.assertBranchAccess(order.snapshot.branchId, 'orders:place');
      if (!access.ok) return access;
    }

    let deliveryProviderCode: string | undefined;
    let externalDeliveryId: string | undefined;
    let providerPayloadSnapshot: Record<string, unknown> | undefined;

    if (
      cmd.toStatus === 'OUT_FOR_DELIVERY' &&
      order.snapshot.orderSource === 'ONLINE_DELIVERY' &&
      !order.snapshot.externalDeliveryId
    ) {
      const branch = await loadBranchPolicy(this.uow, order.snapshot.branchId);
      if (branch?.deliveryMode === 'EXTERNAL_3PL') {
        const dispatch = await this.deliveryProvider.createDeliveryJob({
          orderId: order.id,
          branchId: branch.id,
          branchPostcodeSector: branch.postcodeSector,
          dropoffPostcodeSector: branch.postcodeSector,
          dropoffAddress: 'Customer Verified Address, UK',
          customerName: 'Storefront Customer',
          customerPhone: '+447700900001',
        });
        deliveryProviderCode = dispatch.providerCode;
        externalDeliveryId = dispatch.externalDeliveryId;
        providerPayloadSnapshot = dispatch.rawResponse;
      }
    }

    const res = order.transitionTo(
      cmd.toStatus,
      {
        expectedRowVersion: cmd.expectedRowVersion,
        reason: cmd.reason,
        deliveryProviderCode,
        externalDeliveryId,
        providerPayloadSnapshot,
      },
      {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId: order.snapshot.restaurantId,
      },
    );
    if (!res.ok) return res;

    await this.orderRepo.save(order);
    return ok({
      orderId: order.id,
      status: order.snapshot.status,
      rowVersion: order.version,
      externalDeliveryId: order.snapshot.externalDeliveryId,
    });
  }
}

export interface SettlePosOrderCommand extends Command<Result<void>> {
  readonly orderId: string;
  readonly paymentMethod: OrderPaymentMode;
  readonly tipAmount: number;
  readonly expectedRowVersion?: number;
}

export class SettlePosOrderHandler implements CommandHandler<SettlePosOrderCommand, Result<void>> {
  private readonly orderRepo: OrderRepository;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(orderRepo: OrderRepository, authz: AuthorizationPolicy, request: RequestContext) {
    this.orderRepo = orderRepo;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: SettlePosOrderCommand): Promise<Result<void>> {
    const order = await this.orderRepo.findById(cmd.orderId);
    if (!order) {
      return err(new DomainError('ORDER_NOT_FOUND', `Order ${cmd.orderId} not found.`, 404));
    }

    const access = this.authz.assertBranchAccess(order.snapshot.branchId, 'orders:settle');
    if (!access.ok) return access;

    const settleRes = order.settleBill(
      {
        paymentMode: cmd.paymentMethod,
        tipAmountGbp: new Decimal(cmd.tipAmount ?? 0),
        expectedRowVersion: cmd.expectedRowVersion,
      },
      {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId: order.snapshot.restaurantId,
      },
    );
    if (!settleRes.ok) return settleRes;

    await this.orderRepo.save(order);
    return ok(undefined);
  }
}
