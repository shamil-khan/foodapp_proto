import * as crypto from 'node:crypto';
import {
  BranchMenuOverrideTable,
  CategoryTable,
  type DbReader,
  ItemModifierTable,
  type KdsRoutingTarget,
  MenuItemTable,
  PromotionTable,
  RestaurantBranchTable,
  sqlSelect,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import { formatGbp, roundGbp } from '@/core/domain/money';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { CartLineInput } from '@/orders/application/cart-service';
import type { HydratedCartLineInput } from '@/orders/domain/order-aggregate';
import type {
  OrderChannel,
  OrderPaymentMode,
  OrderStateMachineCode,
} from '@/orders/domain/order-events';

export interface BranchRuntimePolicy {
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

export async function loadBranchPolicy(
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

export function validateChannelCapability(
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

export async function hydrateOrderLines(
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

export async function evaluatePromoCode(params: {
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
