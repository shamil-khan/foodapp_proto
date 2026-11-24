// FILE: apps/backend/src/brand/application/brand-commands.ts (Part 1 of 5)
import * as crypto from 'node:crypto';
import {
  type HomePickupPrivacyMode,
  type KitchenType,
  type MenuSelectionMode,
  type OperationalStatus,
  PaymentConfigTable,
  type Pool,
  type PoolClient,
  RestaurantBranchTable,
  RestaurantLayoutTable,
  RestaurantTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
} from '@foodapp/db';
import type {
  BranchCreatedPayload,
  BranchSettingsUpdatedPayload,
  BrandRegisteredPayload,
} from '@/brand/domain/brand-events';
import type { DropPointConfig, TakeawayWhitelistEntry } from '@/brand/domain/location-privacy';
import { resolveTenantBootstrapPlan } from '@/brand/domain/tenant-bootstrap-strategy';
import type { BranchStatusCache } from '@/brand/infrastructure/branch-status-cache';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import type { EventBus } from '@/core/application/event-bus';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export function hashStaffPassword(plainPassword: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(plainPassword, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export function slugifyKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const RESERVED_BRAND_HANDLES = new Set([
  'register',
  'admin',
  'auth',
  'me',
]);

export interface RegisterBrandCommand
  extends Command<
    Result<{
      restaurantId: string;
      brandHandle: string;
      branchId: string;
      branchKey: string;
      cityKey: string;
      ownerStaffId: string;
    }>
  > {
  readonly brandName: string;
  readonly handle: string;
  readonly logoUrl?: string;
  readonly description?: string;
  readonly kitchenType: KitchenType;
  readonly isMultiBranchEnterprise?: boolean;
  readonly branchName: string;
  readonly branchKey?: string;
  readonly city: string;
  readonly postcodeSector: string;
  readonly streetAddress: string;
  readonly areaLocality?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly contactPersonName: string;
  readonly contactPersonPhone: string;
  readonly contactPersonEmail?: string;
  readonly supportsDineIn?: boolean;
  readonly supportsTakeaway?: boolean;
  readonly supportsPlatformDelivery?: boolean;
  readonly dropPointConfig?: DropPointConfig | null;
  readonly ownerName: string;
  readonly ownerEmail: string;
  readonly ownerPassword: string;
}
// FILE: apps/backend/src/brand/application/brand-commands.ts (Part 2 of 5)
export class RegisterBrandHandler
  implements
    CommandHandler<
      RegisterBrandCommand,
      Result<{
        restaurantId: string;
        brandHandle: string;
        branchId: string;
        branchKey: string;
        cityKey: string;
        ownerStaffId: string;
      }>
    >
{
  private readonly pool: Pool;
  private readonly eventBus: EventBus;
  private readonly request: RequestContext;

  constructor(pool: Pool, eventBus: EventBus, request: RequestContext) {
    this.pool = pool;
    this.eventBus = eventBus;
    this.request = request;
  }

  private async insertBrandAndBranch(
    client: PoolClient,
    cmd: RegisterBrandCommand,
    cleanHandle: string,
    cityKey: string,
    branchKey: string,
    plan: ReturnType<typeof resolveTenantBootstrapPlan>,
  ): Promise<{
    restaurantId: string;
    branchId: string;
  }> {
    const rCols = RestaurantTable.cols;
    const restIns = sqlInsert(RestaurantTable)
      .values({
        name: cmd.brandName.trim(),
        handle: cleanHandle,
        logoUrl: cmd.logoUrl ?? null,
        description: cmd.description ?? null,
        postcodeSector: cmd.postcodeSector.trim().toUpperCase(),
        isActiveOverride: true,
        createdBy: this.request.actorId,
        updatedBy: this.request.actorId,
      })
      .returning([
        rCols.id,
      ])
      .compile();
    const restaurantId = (await client.query<typeof restIns._result>(restIns.text, restIns.params))
      .rows[0]?.id;
    if (!restaurantId) throw new Error('Failed to insert Restaurant');

    const bCols = RestaurantBranchTable.cols;
    const branchIns = sqlInsert(RestaurantBranchTable)
      .values({
        restaurantId,
        name: cmd.branchName.trim(),
        branchKey,
        city: cmd.city.trim(),
        cityKey,
        kitchenType: cmd.kitchenType,
        postcodeSector: cmd.postcodeSector.trim().toUpperCase(),
        streetAddress: cmd.streetAddress.trim(),
        areaLocality: cmd.areaLocality?.trim() ?? null,
        latitude: cmd.latitude?.toFixed(6) ?? null,
        longitude: cmd.longitude?.toFixed(6) ?? null,
        contactPersonName: cmd.contactPersonName.trim(),
        contactPersonPhone: cmd.contactPersonPhone.trim(),
        contactPersonEmail: cmd.contactPersonEmail?.trim() ?? null,
        supportsDineIn: cmd.supportsDineIn ?? plan.fulfillmentDefaults.supportsDineIn,
        supportsTakeaway: cmd.supportsTakeaway ?? plan.fulfillmentDefaults.supportsTakeaway,
        supportsPlatformDelivery:
          cmd.supportsPlatformDelivery ?? plan.fulfillmentDefaults.supportsPlatformDelivery,
        dropPointConfig: (cmd.dropPointConfig ?? null) as unknown as Record<string, unknown>,
        createdBy: this.request.actorId,
        updatedBy: this.request.actorId,
      })
      .returning([
        bCols.id,
      ])
      .compile();
    const branchId = (
      await client.query<typeof branchIns._result>(branchIns.text, branchIns.params)
    ).rows[0]?.id;
    if (!branchId) throw new Error('Failed to insert RestaurantBranch');
    return {
      restaurantId,
      branchId,
    };
  }
  // FILE: apps/backend/src/brand/application/brand-commands.ts (Part 3 of 5)
  // FILE: apps/backend/src/brand/application/brand-commands.ts (Line 183)
  async execute(cmd: RegisterBrandCommand): Promise<
    Result<{
      restaurantId: string;
      brandHandle: string;
      branchId: string;
      branchKey: string;
      cityKey: string;
      ownerStaffId: string;
    }>
  > {
    const cleanHandle = slugifyKey(cmd.handle);
    if (RESERVED_BRAND_HANDLES.has(cleanHandle)) {
      return err(
        new DomainError(
          'RESERVED_HANDLE',
          `Brand handle "${cleanHandle}" is reserved by the platform.`,
          400,
        ),
      );
    }
    const cityKey = slugifyKey(cmd.city);
    const branchKey = slugifyKey(cmd.branchKey ?? cmd.branchName);

    const rCols = RestaurantTable.cols;
    const dupQ = sqlSelect(RestaurantTable)
      .select([
        rCols.id,
      ])
      .whereEq(rCols.handle, cleanHandle)
      .compile();
    if ((await this.pool.query<typeof dupQ._result>(dupQ.text, dupQ.params)).rows[0]) {
      return err(
        new DomainError(
          'HANDLE_TAKEN',
          `Brand handle "${cleanHandle}" is already registered.`,
          409,
        ),
      );
    }

    const plan = resolveTenantBootstrapPlan({
      kitchenType: cmd.kitchenType,
      isMultiBranchEnterprise: cmd.isMultiBranchEnterprise,
    });
    const client = await this.pool.connect();
    let restaurantId = '';
    let branchId = '';

    try {
      await client.query('BEGIN');
      const created = await this.insertBrandAndBranch(
        client,
        cmd,
        cleanHandle,
        cityKey,
        branchKey,
        plan,
      );
      restaurantId = created.restaurantId;
      branchId = created.branchId;

      const layoutQ = sqlInsert(RestaurantLayoutTable)
        .values({
          restaurantId,
          templateId:
            cmd.kitchenType === 'HOME_KITCHEN' ? 'home_creator_warm_v1' : 'uk_pos_modern_v1',
          primaryColor: '#1E293B',
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .compile();
      await client.query(layoutQ.text, layoutQ.params);

      const payQ = sqlInsert(PaymentConfigTable)
        .values({
          restaurantId,
          routingPolicy: 'CENTRAL_ESCROW',
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .compile();
      await client.query(payQ.text, payQ.params);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const ownerStaffId = crypto.randomUUID();
    // BrandOnboardingSaga coordinates IAM owner/role bootstrap and Catalog policy bootstrap atomically
    await this.eventBus.publish([
      {
        eventId: crypto.randomUUID(),
        aggregateId: restaurantId,
        aggregateType: 'BrandAggregate',
        eventType: 'BrandRegistered',
        version: 1,
        occurredAt: new Date(),
        payload: {
          restaurantId,
          brandName: cmd.brandName.trim(),
          brandHandle: cleanHandle,
          branchId,
          branchName: cmd.branchName.trim(),
          postcodeSector: cmd.postcodeSector.trim().toUpperCase(),
          kitchenType: cmd.kitchenType,
          isMultiBranchEnterprise: Boolean(cmd.isMultiBranchEnterprise),
          ownerStaffId,
          ownerName: cmd.ownerName.trim(),
          ownerEmail: cmd.ownerEmail.trim().toLowerCase(),
          ownerPasswordHash: hashStaffPassword(cmd.ownerPassword),
        } satisfies BrandRegisteredPayload,
        metadata: {
          requestId: this.request.requestId,
          actorId: this.request.actorId,
          restaurantId,
        },
      },
    ]);

    return ok({
      restaurantId,
      brandHandle: cleanHandle,
      branchId,
      branchKey,
      cityKey,
      ownerStaffId,
    });
  }
}
// FILE: apps/backend/src/brand/application/brand-commands.ts (Part 4 of 5)
export interface CreateBrandBranchCommand
  extends Command<
    Result<{
      branchId: string;
      cityKey: string;
      branchKey: string;
    }>
  > {
  readonly restaurantId: string;
  readonly name: string;
  readonly branchKey?: string;
  readonly city: string;
  readonly kitchenType: KitchenType;
  readonly postcodeSector: string;
  readonly streetAddress: string;
  readonly areaLocality?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly contactPersonName: string;
  readonly contactPersonPhone: string;
  readonly contactPersonEmail?: string;
  readonly supportsDineIn?: boolean;
  readonly supportsTakeaway?: boolean;
  readonly supportsPlatformDelivery?: boolean;
  readonly menuSelectionMode?: MenuSelectionMode;
}

export class CreateBrandBranchHandler
  implements
    CommandHandler<
      CreateBrandBranchCommand,
      Result<{
        branchId: string;
        cityKey: string;
        branchKey: string;
      }>
    >
{
  private readonly pool: Pool;
  private readonly eventBus: EventBus;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, eventBus: EventBus, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
    this.eventBus = eventBus;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: CreateBrandBranchCommand): Promise<
    Result<{
      branchId: string;
      cityKey: string;
      branchKey: string;
    }>
  > {
    const access = this.authz.assertRestaurantAccess(cmd.restaurantId, 'brand:branches:create');
    if (!access.ok) return access;

    const rCols = RestaurantTable.cols;
    const brandQ = sqlSelect(RestaurantTable)
      .select([
        rCols.name,
      ])
      .whereEq(rCols.id, cmd.restaurantId)
      .activeOnly()
      .compile();
    const brandName =
      (await this.pool.query<typeof brandQ._result>(brandQ.text, brandQ.params)).rows[0]?.name ??
      cmd.name.trim();

    const cityKey = slugifyKey(cmd.city);
    const branchKey = slugifyKey(cmd.branchKey ?? cmd.name);
    const plan = resolveTenantBootstrapPlan({
      kitchenType: cmd.kitchenType,
    });
    const bCols = RestaurantBranchTable.cols;

    const dup = sqlSelect(RestaurantBranchTable)
      .select([
        bCols.id,
      ])
      .whereEq(bCols.restaurantId, cmd.restaurantId)
      .whereEq(bCols.cityKey, cityKey)
      .whereEq(bCols.branchKey, branchKey)
      .activeOnly()
      .compile();
    const dupRes = await this.pool.query<typeof dup._result>(dup.text, dup.params);
    if (dupRes.rows[0]) {
      return err(
        new DomainError(
          'BRANCH_EXISTS',
          `Branch "${branchKey}" already exists in city "${cityKey}".`,
          409,
        ),
      );
    }

    const menuSelectionMode = cmd.menuSelectionMode ?? 'ALL_BRAND_ITEMS';
    const postcodeSector = cmd.postcodeSector.trim().toUpperCase();
    const ins = sqlInsert(RestaurantBranchTable)
      .values({
        restaurantId: cmd.restaurantId,
        name: cmd.name.trim(),
        branchKey,
        city: cmd.city.trim(),
        cityKey,
        kitchenType: cmd.kitchenType,
        postcodeSector,
        streetAddress: cmd.streetAddress.trim(),
        areaLocality: cmd.areaLocality?.trim() ?? null,
        latitude: cmd.latitude !== undefined ? cmd.latitude.toFixed(6) : null,
        longitude: cmd.longitude !== undefined ? cmd.longitude.toFixed(6) : null,
        contactPersonName: cmd.contactPersonName.trim(),
        contactPersonPhone: cmd.contactPersonPhone.trim(),
        contactPersonEmail: cmd.contactPersonEmail?.trim() ?? null,
        supportsDineIn: cmd.supportsDineIn ?? plan.fulfillmentDefaults.supportsDineIn,
        supportsTakeaway: cmd.supportsTakeaway ?? plan.fulfillmentDefaults.supportsTakeaway,
        supportsPlatformDelivery:
          cmd.supportsPlatformDelivery ?? plan.fulfillmentDefaults.supportsPlatformDelivery,
        menuSelectionMode,
        createdBy: this.request.actorId,
        updatedBy: this.request.actorId,
      })
      .returning([
        bCols.id,
      ])
      .compile();
    const res = await this.pool.query<typeof ins._result>(ins.text, ins.params);
    const branchId = res.rows[0]?.id;
    if (!branchId) throw new Error('Failed to create branch');

    // Sync branch metadata into catalog's read-model projection via domain event
    await this.eventBus.publish([
      {
        eventId: crypto.randomUUID(),
        aggregateId: branchId,
        aggregateType: 'BranchAggregate',
        eventType: 'BranchCreated',
        version: 1,
        occurredAt: new Date(),
        payload: {
          restaurantId: cmd.restaurantId,
          brandName,
          branchId,
          branchName: cmd.name.trim(),
          postcodeSector,
          menuSelectionMode,
        } satisfies BranchCreatedPayload,
        metadata: {
          requestId: this.request.requestId,
          actorId: this.request.actorId,
          restaurantId: cmd.restaurantId,
        },
      },
    ]);

    return ok({
      branchId,
      cityKey,
      branchKey,
    });
  }
}
// FILE: apps/backend/src/brand/application/brand-commands.ts (Part 5 of 5)
export interface UpdateBranchOperationalStatusCommand
  extends Command<
    Result<{
      operationalStatus: OperationalStatus;
      statusLockedUntil: string | null;
    }>
  > {
  readonly branchId: string;
  readonly operationalStatus: OperationalStatus;
  readonly reason?: string;
}

export class UpdateBranchOperationalStatusHandler
  implements
    CommandHandler<
      UpdateBranchOperationalStatusCommand,
      Result<{
        operationalStatus: OperationalStatus;
        statusLockedUntil: string | null;
      }>
    >
{
  private readonly pool: Pool;
  private readonly statusCache: BranchStatusCache;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    pool: Pool,
    statusCache: BranchStatusCache,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.pool = pool;
    this.statusCache = statusCache;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: UpdateBranchOperationalStatusCommand): Promise<
    Result<{
      operationalStatus: OperationalStatus;
      statusLockedUntil: string | null;
    }>
  > {
    const access = this.authz.assertBranchAccess(
      cmd.branchId,
      'branch:status:manage',
      'platform:support:branch-override',
    );
    if (!access.ok) return access;

    const bCols = RestaurantBranchTable.cols;
    const lookup = sqlSelect(RestaurantBranchTable)
      .select([
        bCols.id,
        bCols.operationalStatus,
        bCols.statusLockedUntil,
      ])
      .whereEq(bCols.id, cmd.branchId)
      .activeOnly()
      .compile();
    const res = await this.pool.query<typeof lookup._result>(lookup.text, lookup.params);
    const branch = res.rows[0];
    if (!branch) {
      return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));
    }

    const now = new Date();
    if (
      !this.authz.isPlatformAdmin() &&
      branch.operationalStatus === 'BUSY_PAUSED' &&
      branch.statusLockedUntil &&
      new Date(branch.statusLockedUntil) > now
    ) {
      return err(
        new DomainError(
          'STATUS_COOLDOWN_ACTIVE',
          `Branch status is locked in BUSY_PAUSED until ${new Date(branch.statusLockedUntil).toISOString()}.`,
          409,
        ),
      );
    }

    const lockedUntil =
      cmd.operationalStatus === 'BUSY_PAUSED' ? new Date(now.getTime() + 60 * 60 * 1000) : null;
    const upd = sqlUpdate(RestaurantBranchTable)
      .set({
        operationalStatus: cmd.operationalStatus,
        statusLockedUntil: lockedUntil,
        statusReason: cmd.reason?.trim() ?? null,
      })
      .withAuditBump(this.request.actorId)
      .whereEq(bCols.id, cmd.branchId)
      .whereNull(bCols.deletedAt)
      .compile();
    await this.pool.query(upd.text, upd.params);

    const lockedUntilIso = lockedUntil ? lockedUntil.toISOString() : null;
    await this.statusCache.setStatus({
      branchId: cmd.branchId,
      operationalStatus: cmd.operationalStatus,
      statusLockedUntil: lockedUntilIso,
      statusReason: cmd.reason?.trim() ?? null,
    });

    return ok({
      operationalStatus: cmd.operationalStatus,
      statusLockedUntil: lockedUntilIso,
    });
  }
}

export interface UpdateBranchSettingsCommand extends Command<Result<void>> {
  readonly branchId: string;
  readonly supportsDineIn?: boolean;
  readonly supportsTakeaway?: boolean;
  readonly supportsPlatformDelivery?: boolean;
  readonly homePickupPrivacyMode?: HomePickupPrivacyMode;
  readonly dropPointConfig?: DropPointConfig | null;
  readonly menuSelectionMode?: MenuSelectionMode;
  readonly scheduleConfig?: Record<string, unknown>;
  readonly contactPersonName?: string;
  readonly contactPersonPhone?: string;
  readonly contactPersonEmail?: string | null;
}

export class UpdateBranchSettingsHandler
  implements CommandHandler<UpdateBranchSettingsCommand, Result<void>>
{
  private readonly pool: Pool;
  private readonly eventBus: EventBus;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, eventBus: EventBus, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
    this.eventBus = eventBus;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: UpdateBranchSettingsCommand): Promise<Result<void>> {
    const access = this.authz.assertBranchAccess(cmd.branchId, 'branch:settings:manage');
    if (!access.ok) return access;

    const bCols = RestaurantBranchTable.cols;
    const sel = sqlSelect(RestaurantBranchTable)
      .select([
        bCols.restaurantId,
      ])
      .whereEq(bCols.id, cmd.branchId)
      .activeOnly()
      .compile();
    const branch = (await this.pool.query<typeof sel._result>(sel.text, sel.params)).rows[0];
    if (!branch) {
      return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));
    }

    const upd = sqlUpdate(RestaurantBranchTable)
      .set({
        supportsDineIn: cmd.supportsDineIn,
        supportsTakeaway: cmd.supportsTakeaway,
        supportsPlatformDelivery: cmd.supportsPlatformDelivery,
        homePickupPrivacyMode: cmd.homePickupPrivacyMode,
        dropPointConfig:
          cmd.dropPointConfig !== undefined
            ? (cmd.dropPointConfig as unknown as Record<string, unknown>)
            : undefined,
        menuSelectionMode: cmd.menuSelectionMode,
        scheduleConfig: cmd.scheduleConfig,
        contactPersonName: cmd.contactPersonName,
        contactPersonPhone: cmd.contactPersonPhone,
        contactPersonEmail: cmd.contactPersonEmail,
      })
      .withAuditBump(this.request.actorId)
      .whereEq(bCols.id, cmd.branchId)
      .whereNull(bCols.deletedAt)
      .compile();

    await this.pool.query(upd.text, upd.params);

    if (cmd.menuSelectionMode !== undefined) {
      await this.eventBus.publish([
        {
          eventId: crypto.randomUUID(),
          aggregateId: cmd.branchId,
          aggregateType: 'BranchAggregate',
          eventType: 'BranchSettingsUpdated',
          version: 1,
          occurredAt: new Date(),
          payload: {
            restaurantId: branch.restaurantId,
            branchId: cmd.branchId,
            menuSelectionMode: cmd.menuSelectionMode,
          } satisfies BranchSettingsUpdatedPayload,
          metadata: {
            requestId: this.request.requestId,
            actorId: this.request.actorId,
            restaurantId: branch.restaurantId,
          },
        },
      ]);
    }
    return ok(undefined);
  }
}

export interface ReviewTakeawayWhitelistCommand extends Command<Result<void>> {
  readonly branchId: string;
  readonly customerUserId: string;
  readonly decision: 'APPROVED' | 'REJECTED';
}

export class ReviewTakeawayWhitelistHandler
  implements CommandHandler<ReviewTakeawayWhitelistCommand, Result<void>>
{
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: ReviewTakeawayWhitelistCommand): Promise<Result<void>> {
    const access = this.authz.assertBranchAccess(cmd.branchId, 'branch:whitelist:manage');
    if (!access.ok) return access;

    const bCols = RestaurantBranchTable.cols;
    const sel = sqlSelect(RestaurantBranchTable)
      .select([
        bCols.id,
        bCols.approvedTakeawayUserIds,
      ])
      .whereEq(bCols.id, cmd.branchId)
      .activeOnly()
      .compile();
    const res = await this.pool.query<typeof sel._result>(sel.text, sel.params);
    const branch = res.rows[0];
    if (!branch) {
      return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));
    }

    const current = Array.isArray(branch.approvedTakeawayUserIds)
      ? (branch.approvedTakeawayUserIds as unknown as TakeawayWhitelistEntry[])
      : [];
    const filtered = current.filter((e) => e.userId !== cmd.customerUserId);
    filtered.push({
      userId: cmd.customerUserId,
      status: cmd.decision,
    });

    const upd = sqlUpdate(RestaurantBranchTable)
      .set({
        approvedTakeawayUserIds: JSON.stringify(filtered) as unknown as Record<string, unknown>,
      })
      .withAuditBump(this.request.actorId)
      .whereEq(bCols.id, cmd.branchId)
      .whereNull(bCols.deletedAt)
      .compile();
    await this.pool.query(upd.text, upd.params);
    return ok(undefined);
  }
}
