import * as crypto from 'node:crypto';
import {
  type HomePickupPrivacyMode,
  type KitchenType,
  type MenuSelectionMode,
  type OperationalStatus,
  PaymentConfigTable,
  type Pool,
  type PoolClient,
  PricingPolicyTable,
  RestaurantBranchTable,
  RestaurantLayoutTable,
  RestaurantStaffTable,
  RestaurantTable,
  StaffBranchAssignmentTable,
  StaffRolePermissionTable,
  StaffRoleTable,
  SYSTEM_ROLE_DEFINITIONS,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
} from '@foodapp/db';
import type { DropPointConfig, TakeawayWhitelistEntry } from '@/catalog/domain/location-privacy';
import { resolveTenantBootstrapPlan } from '@/catalog/domain/tenant-bootstrap-strategy';
import type { BranchStatusCache } from '@/catalog/infrastructure/branch-status-cache';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
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
  'branches',
  'pos',
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
  private readonly request: RequestContext;

  constructor(pool: Pool, request: RequestContext) {
    this.pool = pool;
    this.request = request;
  }

  private async seedRoles(
    client: PoolClient,
    restaurantId: string,
    plan: ReturnType<typeof resolveTenantBootstrapPlan>,
  ): Promise<string> {
    let ownerRoleId = '';
    const srCols = StaffRoleTable.cols;
    for (const roleName of plan.rolesToSeed) {
      const def = SYSTEM_ROLE_DEFINITIONS[roleName];
      const roleIns = sqlInsert(StaffRoleTable)
        .values({
          restaurantId,
          name: roleName,
          description: def.description,
          isSystemRole: true,
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .returning([
          srCols.id,
        ])
        .compile();
      const roleRes = await client.query<typeof roleIns._result>(roleIns.text, roleIns.params);
      const createdRoleId = roleRes.rows[0]?.id;
      if (!createdRoleId) throw new Error(`Failed to seed role ${roleName}`);
      if (roleName === plan.ownerRoleName) ownerRoleId = createdRoleId;

      for (const perm of def.permissions) {
        const permIns = sqlInsert(StaffRolePermissionTable)
          .values({
            staffRoleId: createdRoleId,
            permission: perm,
            createdBy: this.request.actorId,
            updatedBy: this.request.actorId,
          })
          .compile();
        await client.query(permIns.text, permIns.params);
      }
    }
    return ownerRoleId;
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

  // UPDATE the top of `async execute(cmd: RegisterBrandCommand)` in `RegisterBrandHandler`:

  async execute(cmd: RegisterBrandCommand) {
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

    try {
      await client.query('BEGIN');
      const { restaurantId, branchId } = await this.insertBrandAndBranch(
        client,
        cmd,
        cleanHandle,
        cityKey,
        branchKey,
        plan,
      );

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

      const policyQ = sqlInsert(PricingPolicyTable)
        .values({
          restaurantId,
          branchId: null,
          menuPricingMode: cmd.isMultiBranchEnterprise ? 'THRESHOLD_HYBRID' : 'BRANCH_DIRECT',
          maxDirectPriceDeltaPercent: cmd.isMultiBranchEnterprise ? '10.00' : '25.00',
          allowBranchLocalItems: true,
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .compile();
      await client.query(policyQ.text, policyQ.params);

      const ownerRoleId = await this.seedRoles(client, restaurantId, plan);
      const sCols = RestaurantStaffTable.cols;
      const staffIns = sqlInsert(RestaurantStaffTable)
        .values({
          restaurantId,
          email: cmd.ownerEmail.trim().toLowerCase(),
          passwordHash: hashStaffPassword(cmd.ownerPassword),
          name: cmd.ownerName.trim(),
          role: 'OWNER',
          roleId: ownerRoleId,
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .returning([
          sCols.id,
        ])
        .compile();
      const ownerStaffId = (
        await client.query<typeof staffIns._result>(staffIns.text, staffIns.params)
      ).rows[0]?.id;
      if (!ownerStaffId) throw new Error('Failed to insert owner staff');

      const assignIns = sqlInsert(StaffBranchAssignmentTable)
        .values({
          staffId: ownerStaffId,
          branchId,
          staffRoleId: ownerRoleId,
          directPermissions: [],
          isPrimary: true,
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .compile();
      await client.query(assignIns.text, assignIns.params);

      await client.query('COMMIT');
      return ok({
        restaurantId,
        brandHandle: cleanHandle,
        branchId,
        branchKey,
        cityKey,
        ownerStaffId,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

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
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
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

    const ins = sqlInsert(RestaurantBranchTable)
      .values({
        restaurantId: cmd.restaurantId,
        name: cmd.name.trim(),
        branchKey,
        city: cmd.city.trim(),
        cityKey,
        kitchenType: cmd.kitchenType,
        postcodeSector: cmd.postcodeSector.trim().toUpperCase(),
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
        menuSelectionMode: cmd.menuSelectionMode ?? 'ALL_BRAND_ITEMS',
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

    if (this.request.actorSource === 'POS_STAFF' && this.request.roleId) {
      const assign = sqlInsert(StaffBranchAssignmentTable)
        .values({
          staffId: this.request.actorId,
          branchId,
          staffRoleId: this.request.roleId,
          directPermissions: [],
          isPrimary: false,
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .compile();
      await this.pool.query(assign.text, assign.params);
    }

    return ok({
      branchId,
      cityKey,
      branchKey,
    });
  }
}

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
    const access = this.authz.assertBranchAccess(cmd.branchId, 'branch:status:manage');
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
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: UpdateBranchSettingsCommand): Promise<Result<void>> {
    const access = this.authz.assertBranchAccess(cmd.branchId, 'branch:settings:manage');
    if (!access.ok) return access;

    const bCols = RestaurantBranchTable.cols;
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

    const res = await this.pool.query(upd.text, upd.params);
    if ((res.rowCount ?? 0) === 0) {
      return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));
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
