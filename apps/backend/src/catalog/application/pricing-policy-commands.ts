import * as crypto from 'node:crypto';
import {
  BranchMenuOverrideTable,
  CatalogBranchProjectionTable,
  CategoryTable,
  type KdsRoutingTarget,
  MenuItemTable,
  type MenuPricingPolicyMode,
  type PriceApprovalStatus,
  PricingPolicyTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
  type UnitOfWork,
} from '@foodapp/db';
import {
  type PricingPolicyConfig,
  resolveMenuPricingStrategy,
} from '@/catalog/domain/pricing-workflow';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import type { EventBus } from '@/core/application/event-bus';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export async function loadEffectivePricingPolicy(
  uow: UnitOfWork,
  restaurantId: string,
  branchId: string,
): Promise<PricingPolicyConfig> {
  const pCols = PricingPolicyTable.cols;
  const q = sqlSelect(PricingPolicyTable)
    .select([
      pCols.branchId,
      pCols.menuPricingMode,
      pCols.maxDirectPriceDeltaPercent,
      pCols.allowBranchLocalItems,
      pCols.maxDirectOrderDiscountPercent,
      pCols.allowFullCompWaiveOff,
      pCols.requireReasonForCompOrDiscount,
      pCols.maxDirectRefundAmount,
    ])
    .whereEq(pCols.restaurantId, restaurantId)
    .activeOnly()
    .compile();

  const rows = await uow.queryMany(q);
  const chosen = rows.find((r) => r.branchId === branchId) ?? rows.find((r) => r.branchId === null);

  if (!chosen) {
    return {
      menuPricingMode: 'CENTRAL_LOCKED',
      maxDirectPriceDeltaPercent: 0,
      allowBranchLocalItems: false,
      maxDirectOrderDiscountPercent: 10,
      allowFullCompWaiveOff: false,
      requireReasonForCompOrDiscount: true,
      maxDirectRefundAmount: 25,
    };
  }

  return {
    menuPricingMode: chosen.menuPricingMode as MenuPricingPolicyMode,
    maxDirectPriceDeltaPercent: Number.parseFloat(chosen.maxDirectPriceDeltaPercent),
    allowBranchLocalItems: chosen.allowBranchLocalItems,
    maxDirectOrderDiscountPercent: Number.parseFloat(chosen.maxDirectOrderDiscountPercent),
    allowFullCompWaiveOff: chosen.allowFullCompWaiveOff,
    requireReasonForCompOrDiscount: chosen.requireReasonForCompOrDiscount,
    maxDirectRefundAmount: Number.parseFloat(chosen.maxDirectRefundAmount),
  };
}

export interface UpsertPricingPolicyCommand extends Command<Result<void>> {
  readonly restaurantId: string;
  readonly branchId?: string | null;
  readonly menuPricingMode: MenuPricingPolicyMode;
  readonly maxDirectPriceDeltaPercent: number;
  readonly allowBranchLocalItems: boolean;
  readonly maxDirectOrderDiscountPercent: number;
  readonly allowFullCompWaiveOff: boolean;
  readonly requireReasonForCompOrDiscount: boolean;
  readonly maxDirectRefundAmount: number;
}

export class UpsertPricingPolicyHandler
  implements CommandHandler<UpsertPricingPolicyCommand, Result<void>>
{
  private readonly uow: UnitOfWork;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(uow: UnitOfWork, authz: AuthorizationPolicy, request: RequestContext) {
    this.uow = uow;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: UpsertPricingPolicyCommand): Promise<Result<void>> {
    const access = this.authz.assertRestaurantAccess(cmd.restaurantId, 'pricing:policy:manage');
    if (!access.ok) return access;

    const targetBranchId = cmd.branchId ?? null;
    const pCols = PricingPolicyTable.cols;
    const sel = sqlSelect(PricingPolicyTable)
      .select([
        pCols.id,
        pCols.branchId,
      ])
      .whereEq(pCols.restaurantId, cmd.restaurantId)
      .activeOnly()
      .compile();
    const rows = await this.uow.queryMany(sel);
    const existing = rows.find((r) => r.branchId === targetBranchId);

    if (existing) {
      const upd = sqlUpdate(PricingPolicyTable)
        .set({
          menuPricingMode: cmd.menuPricingMode,
          maxDirectPriceDeltaPercent: cmd.maxDirectPriceDeltaPercent.toFixed(2),
          allowBranchLocalItems: cmd.allowBranchLocalItems,
          maxDirectOrderDiscountPercent: cmd.maxDirectOrderDiscountPercent.toFixed(2),
          allowFullCompWaiveOff: cmd.allowFullCompWaiveOff,
          requireReasonForCompOrDiscount: cmd.requireReasonForCompOrDiscount,
          maxDirectRefundAmount: cmd.maxDirectRefundAmount.toFixed(2),
        })
        .withAuditBump(this.request.actorId)
        .whereEq(pCols.id, existing.id)
        .whereNull(pCols.deletedAt)
        .compile();
      await this.uow.execute(upd);
      return ok(undefined);
    }

    const ins = sqlInsert(PricingPolicyTable)
      .values({
        restaurantId: cmd.restaurantId,
        branchId: targetBranchId,
        menuPricingMode: cmd.menuPricingMode,
        maxDirectPriceDeltaPercent: cmd.maxDirectPriceDeltaPercent.toFixed(2),
        allowBranchLocalItems: cmd.allowBranchLocalItems,
        maxDirectOrderDiscountPercent: cmd.maxDirectOrderDiscountPercent.toFixed(2),
        allowFullCompWaiveOff: cmd.allowFullCompWaiveOff,
        requireReasonForCompOrDiscount: cmd.requireReasonForCompOrDiscount,
        maxDirectRefundAmount: cmd.maxDirectRefundAmount.toFixed(2),
        createdBy: this.request.actorId,
        updatedBy: this.request.actorId,
      })
      .compile();
    await this.uow.execute(ins);
    return ok(undefined);
  }
}

export interface UpsertBranchMenuOverrideCommand
  extends Command<
    Result<{
      approvalStatus: PriceApprovalStatus;
      priceOverride: number | null;
      pendingPriceOverride: number | null;
    }>
  > {
  readonly branchId: string;
  readonly menuItemId: string;
  readonly isIncluded?: boolean;
  readonly isAvailable?: boolean;
  readonly proposedPrice?: number | null;
}

export class UpsertBranchMenuOverrideHandler
  implements
    CommandHandler<
      UpsertBranchMenuOverrideCommand,
      Result<{
        approvalStatus: PriceApprovalStatus;
        priceOverride: number | null;
        pendingPriceOverride: number | null;
      }>
    >
{
  private readonly uow: UnitOfWork;
  private readonly eventBus: EventBus;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    eventBus: EventBus,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.eventBus = eventBus;
    this.authz = authz;
    this.request = request;
  }

  private async resolveDecision(
    restaurantId: string,
    branchId: string,
    basePrice: number,
    proposedPrice?: number | null,
  ) {
    if (proposedPrice === undefined || proposedPrice === null) {
      return ok({
        approvalStatus: 'NONE' as PriceApprovalStatus,
        priceOverride: null,
        pendingPriceOverride: null,
      });
    }
    const policy = await loadEffectivePricingPolicy(this.uow, restaurantId, branchId);
    const strategy = resolveMenuPricingStrategy(policy.menuPricingMode);
    return strategy.evaluatePriceProposal({
      basePrice,
      proposedPrice,
      policy,
      canApproveDirectly: this.authz.hasPermission('catalog:price:approve'),
    });
  }

  private async saveOverrideRow(
    cmd: UpsertBranchMenuOverrideCommand,
    decision: {
      approvalStatus: PriceApprovalStatus;
      priceOverride: number | null;
      pendingPriceOverride: number | null;
    },
  ): Promise<void> {
    const oCols = BranchMenuOverrideTable.cols;
    const exQ = sqlSelect(BranchMenuOverrideTable)
      .select([
        oCols.id,
      ])
      .whereEq(oCols.branchId, cmd.branchId)
      .whereEq(oCols.menuItemId, cmd.menuItemId)
      .activeOnly()
      .compile();
    const existing = await this.uow.queryOne(exQ);
    const hasPrice = cmd.proposedPrice !== undefined;

    if (existing) {
      const upd = sqlUpdate(BranchMenuOverrideTable)
        .set({
          isIncluded: cmd.isIncluded,
          isAvailable: cmd.isAvailable,
          priceOverride: hasPrice ? (decision.priceOverride?.toFixed(2) ?? null) : undefined,
          pendingPriceOverride: hasPrice
            ? (decision.pendingPriceOverride?.toFixed(2) ?? null)
            : undefined,
          approvalStatus: hasPrice ? decision.approvalStatus : undefined,
          requestedByStaffId: this.request.actorId,
        })
        .withAuditBump(this.request.actorId)
        .whereEq(oCols.id, existing.id)
        .whereNull(oCols.deletedAt)
        .compile();
      await this.uow.execute(upd);
      return;
    }

    const ins = sqlInsert(BranchMenuOverrideTable)
      .values({
        branchId: cmd.branchId,
        menuItemId: cmd.menuItemId,
        isIncluded: cmd.isIncluded ?? true,
        isAvailable: cmd.isAvailable ?? true,
        priceOverride: decision.priceOverride?.toFixed(2) ?? null,
        pendingPriceOverride: decision.pendingPriceOverride?.toFixed(2) ?? null,
        approvalStatus: decision.approvalStatus,
        requestedByStaffId: this.request.actorId,
        createdBy: this.request.actorId,
        updatedBy: this.request.actorId,
      })
      .compile();
    await this.uow.execute(ins);
  }

  async execute(cmd: UpsertBranchMenuOverrideCommand) {
    const requiredRight =
      cmd.proposedPrice !== undefined ? 'catalog:price:update' : 'catalog:items:manage';
    const access = this.authz.assertBranchAccess(
      cmd.branchId,
      requiredRight,
      'platform:support:catalog-override',
    );
    if (!access.ok) return access;

    const bCols = CatalogBranchProjectionTable.cols;
    const bQ = sqlSelect(CatalogBranchProjectionTable)
      .select([
        bCols.branchId,
        bCols.restaurantId,
      ])
      .whereEq(bCols.branchId, cmd.branchId)
      .activeOnly()
      .compile();

    const branch = await this.uow.queryOne(bQ);
    if (!branch) return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));

    const mCols = MenuItemTable.cols;
    const mQ = sqlSelect(MenuItemTable)
      .select([
        mCols.id,
        mCols.basePrice,
      ])
      .whereEq(mCols.id, cmd.menuItemId)
      .activeOnly()
      .compile();
    const item = await this.uow.queryOne(mQ);
    if (!item) return err(new DomainError('ITEM_NOT_FOUND', 'Menu item not found.', 404));

    const decisionRes = await this.resolveDecision(
      branch.restaurantId,
      cmd.branchId,
      Number.parseFloat(item.basePrice),
      cmd.proposedPrice,
    );
    if (!decisionRes.ok) return decisionRes;

    await this.saveOverrideRow(cmd, decisionRes.value);
    await this.eventBus.publish([
      {
        eventId: crypto.randomUUID(),
        aggregateId: cmd.branchId,
        aggregateType: 'BranchCatalog',
        eventType: 'BranchMenuUpdated',
        version: 1,
        occurredAt: new Date(),
        payload: {
          branchId: cmd.branchId,
          menuItemId: cmd.menuItemId,
        },
        metadata: {
          requestId: this.request.requestId,
          actorId: this.request.actorId,
          restaurantId: branch.restaurantId,
        },
      },
    ]);

    return ok(decisionRes.value);
  }
}

export interface ReviewPriceOverrideCommand extends Command<Result<void>> {
  readonly branchId: string;
  readonly menuItemId: string;
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly reviewNote?: string;
}

export class ReviewPriceOverrideHandler
  implements CommandHandler<ReviewPriceOverrideCommand, Result<void>>
{
  private readonly uow: UnitOfWork;
  private readonly eventBus: EventBus;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    eventBus: EventBus,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.eventBus = eventBus;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: ReviewPriceOverrideCommand): Promise<Result<void>> {
    const access = this.authz.assertBranchAccess(cmd.branchId, 'catalog:price:approve');
    if (!access.ok) return access;

    const oCols = BranchMenuOverrideTable.cols;
    const sel = sqlSelect(BranchMenuOverrideTable)
      .select([
        oCols.id,
        oCols.pendingPriceOverride,
        oCols.approvalStatus,
      ])
      .whereEq(oCols.branchId, cmd.branchId)
      .whereEq(oCols.menuItemId, cmd.menuItemId)
      .activeOnly()
      .compile();
    const row = await this.uow.queryOne(sel);
    if (row?.approvalStatus !== 'PENDING' || row.pendingPriceOverride === null) {
      return err(
        new DomainError(
          'NO_PENDING_OVERRIDE',
          'No pending price override found for this item.',
          404,
        ),
      );
    }

    const upd = sqlUpdate(BranchMenuOverrideTable)
      .set({
        priceOverride: cmd.decision === 'APPROVED' ? row.pendingPriceOverride : undefined,
        pendingPriceOverride: null,
        approvalStatus: cmd.decision,
        reviewedByStaffId: this.request.actorId,
        reviewNote: cmd.reviewNote?.trim() ?? null,
      })
      .withAuditBump(this.request.actorId)
      .whereEq(oCols.id, row.id)
      .whereNull(oCols.deletedAt)
      .compile();
    await this.uow.execute(upd);

    await this.eventBus.publish([
      {
        eventId: crypto.randomUUID(),
        aggregateId: cmd.branchId,
        aggregateType: 'BranchCatalog',
        eventType: 'BranchMenuUpdated',
        version: 1,
        occurredAt: new Date(),
        payload: {
          branchId: cmd.branchId,
          menuItemId: cmd.menuItemId,
        },
        metadata: {
          requestId: this.request.requestId,
          actorId: this.request.actorId,
          restaurantId: this.request.restaurantId ?? this.request.supportGrant?.restaurantId,
        },
      },
    ]);

    return ok(undefined);
  }
}

export interface CreateMenuItemCommand
  extends Command<
    Result<{
      menuItemId: string;
    }>
  > {
  readonly restaurantId: string;
  readonly categoryId: string;
  readonly branchId?: string | null;
  readonly name: string;
  readonly description?: string;
  readonly basePrice: number;
  readonly vatRate?: number;
  readonly allergenFlags?: readonly string[];
  readonly ingredientTags?: readonly string[];
  readonly kdsTarget?: KdsRoutingTarget;
}

export class CreateMenuItemHandler
  implements
    CommandHandler<
      CreateMenuItemCommand,
      Result<{
        menuItemId: string;
      }>
    >
{
  private readonly uow: UnitOfWork;
  private readonly eventBus: EventBus;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    eventBus: EventBus,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.eventBus = eventBus;
    this.authz = authz;
    this.request = request;
  }

  private normalizeTags(tags?: readonly string[]): string[] {
    return Array.from(
      new Set(
        (tags ?? []).map((t) => {
          const clean = t.trim().toLowerCase();
          return clean.startsWith('#') ? clean : `#${clean}`;
        }),
      ),
    );
  }

  async execute(cmd: CreateMenuItemCommand): Promise<
    Result<{
      menuItemId: string;
    }>
  > {
    const access = cmd.branchId
      ? this.authz.assertBranchAccess(
          cmd.branchId,
          'catalog:items:manage',
          'platform:support:catalog-override',
        )
      : this.authz.assertRestaurantAccess(
          cmd.restaurantId,
          'catalog:items:manage',
          'platform:support:catalog-override',
        );
    if (!access.ok) return access;

    if (cmd.branchId) {
      const policy = await loadEffectivePricingPolicy(this.uow, cmd.restaurantId, cmd.branchId);
      if (!policy.allowBranchLocalItems && !this.authz.hasPermission('pricing:policy:manage')) {
        return err(
          new DomainError(
            'BRANCH_LOCAL_ITEMS_FORBIDDEN',
            'Pricing policy does not allow creating branch-local menu items.',
            403,
          ),
        );
      }
    }

    const cCols = CategoryTable.cols;
    const catQ = sqlSelect(CategoryTable)
      .select([
        cCols.id,
        cCols.restaurantId,
      ])
      .whereEq(cCols.id, cmd.categoryId)
      .activeOnly()
      .compile();
    const cat = await this.uow.queryOne(catQ);
    if (cat?.restaurantId !== cmd.restaurantId) {
      return err(new DomainError('CATEGORY_NOT_FOUND', 'Category not found in brand.', 404));
    }

    const mCols = MenuItemTable.cols;
    const ins = sqlInsert(MenuItemTable)
      .values({
        categoryId: cmd.categoryId,
        branchId: cmd.branchId ?? null,
        name: cmd.name.trim(),
        description: cmd.description?.trim() ?? null,
        basePrice: cmd.basePrice.toFixed(2),
        vatRate: (cmd.vatRate ?? 20).toFixed(2),
        allergenFlags: [
          ...(cmd.allergenFlags ?? []),
        ],
        ingredientTags: this.normalizeTags(cmd.ingredientTags),
        kdsTarget: cmd.kdsTarget ?? 'KITCHEN_SCREEN',
        isActive: true,
        createdBy: this.request.actorId,
        updatedBy: this.request.actorId,
      })
      .returning([
        mCols.id,
      ])
      .compile();
    const inserted = await this.uow.queryOne(ins);
    const menuItemId = inserted?.id;
    if (!menuItemId) throw new Error('Failed to create MenuItem');
    if (cmd.branchId) {
      await this.eventBus.publish([
        {
          eventId: crypto.randomUUID(),
          aggregateId: cmd.branchId,
          aggregateType: 'BranchCatalog',
          eventType: 'BranchMenuUpdated',
          version: 1,
          occurredAt: new Date(),
          payload: {
            branchId: cmd.branchId,
            menuItemId,
          },
          metadata: {
            requestId: this.request.requestId,
            actorId: this.request.actorId,
            restaurantId: cmd.restaurantId,
          },
        },
      ]);
    }
    return ok({
      menuItemId,
    });
  }
}
