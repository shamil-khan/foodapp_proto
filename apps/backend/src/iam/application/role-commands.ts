import {
  type DbExecutor,
  type PermissionEffect,
  RestaurantBranchTable,
  RestaurantStaffTable,
  StaffBranchAssignmentTable,
  StaffDirectPermissionTable,
  StaffRolePermissionTable,
  StaffRoleTable,
  sqlInsert,
  sqlSelect,
  sqlSoftDelete,
  sqlUpdate,
  TENANT_PERMISSIONS,
  type TenantPermission,
  type TenantRole,
  type UnitOfWork,
} from '@foodapp/db';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { RolePermissionCache } from '@/iam/infrastructure/role-permission-cache';

const VALID_TENANT_PERMS = new Set<string>(TENANT_PERMISSIONS);

function sanitizePermissions(perms: readonly string[]): TenantPermission[] {
  return Array.from(new Set(perms)).filter((p): p is TenantPermission => VALID_TENANT_PERMS.has(p));
}

export interface CreateStaffRoleCommand
  extends Command<
    Result<{
      roleId: string;
      name: string;
      permissions: TenantPermission[];
    }>
  > {
  readonly restaurantId: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly TenantPermission[];
}

export class CreateStaffRoleHandler
  implements
    CommandHandler<
      CreateStaffRoleCommand,
      Result<{
        roleId: string;
        name: string;
        permissions: TenantPermission[];
      }>
    >
{
  private readonly uow: UnitOfWork;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(uow: UnitOfWork, authz: AuthorizationPolicy, request: RequestContext) {
    this.uow = uow;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: CreateStaffRoleCommand): Promise<
    Result<{
      roleId: string;
      name: string;
      permissions: TenantPermission[];
    }>
  > {
    const access = this.authz.assertRestaurantAccess(cmd.restaurantId, 'staff:roles:manage');
    if (!access.ok) return access;

    const cleanName = cmd.name.trim().toUpperCase();
    const cleanPerms = sanitizePermissions(cmd.permissions);
    if (cleanPerms.length === 0) {
      return err(new DomainError('INVALID_PERMISSIONS', 'At least one valid right is required.'));
    }

    // Prevent privilege escalation: actors can only grant rights they personally hold
    const delegateCheck = this.authz.assertCanDelegate(cleanPerms);
    if (!delegateCheck.ok) return delegateCheck;
    const rCols = StaffRoleTable.cols;
    const dupCheck = sqlSelect(StaffRoleTable)
      .select([
        rCols.id,
      ])
      .whereEq(rCols.restaurantId, cmd.restaurantId)
      .whereEq(rCols.name, cleanName)
      .activeOnly()
      .compile();

    if (await this.uow.exists(dupCheck)) {
      return err(
        new DomainError('ROLE_EXISTS', `Role "${cleanName}" already exists in this brand.`, 409),
      );
    }

    // Atomically create StaffRole and all StaffRolePermission rows inside one UnitOfWork
    const createdRoleId = await this.uow.transaction(async (tx) => {
      const insertRole = sqlInsert(StaffRoleTable)
        .values({
          restaurantId: cmd.restaurantId,
          name: cleanName,
          description: cmd.description?.trim() ?? null,
          isSystemRole: false,
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .returning([
          rCols.id,
        ])
        .compile();

      const roleRow = await tx.queryOne(insertRole);
      const roleId = roleRow?.id;
      if (!roleId) {
        throw new Error('Failed to create StaffRole record');
      }

      for (const perm of cleanPerms) {
        const insertPerm = sqlInsert(StaffRolePermissionTable)
          .values({
            staffRoleId: roleId,
            permission: perm,
            createdBy: this.request.actorId,
            updatedBy: this.request.actorId,
          })
          .compile();
        await tx.execute(insertPerm);
      }

      return roleId;
    });

    return ok({
      roleId: createdRoleId,
      name: cleanName,
      permissions: cleanPerms,
    });
  }
}

export interface UpdateStaffRoleCommand extends Command<Result<void>> {
  readonly roleId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly permissions: readonly TenantPermission[];
}

export class UpdateStaffRoleHandler
  implements CommandHandler<UpdateStaffRoleCommand, Result<void>>
{
  private readonly uow: UnitOfWork;
  private readonly rolePermissionCache: RolePermissionCache;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    rolePermissionCache: RolePermissionCache,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.rolePermissionCache = rolePermissionCache;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: UpdateStaffRoleCommand): Promise<Result<void>> {
    const rCols = StaffRoleTable.cols;
    const roleQuery = sqlSelect(StaffRoleTable)
      .select([
        rCols.id,
        rCols.restaurantId,
        rCols.name,
        rCols.isSystemRole,
      ])
      .whereEq(rCols.id, cmd.roleId)
      .activeOnly()
      .compile();

    const role = await this.uow.queryOne(roleQuery);
    if (!role) {
      return err(new DomainError('ROLE_NOT_FOUND', `Role ${cmd.roleId} not found.`, 404));
    }

    const access = this.authz.assertRestaurantAccess(role.restaurantId, 'staff:roles:manage');
    if (!access.ok) return access;

    // Predefined system roles are immutable across all tenants
    if (role.isSystemRole) {
      return err(
        new DomainError(
          'SYSTEM_ROLE_LOCKED',
          'Predefined system roles are immutable and cannot be edited.',
          403,
        ),
      );
    }

    const cleanPerms = sanitizePermissions(cmd.permissions);
    if (cleanPerms.length === 0) {
      return err(new DomainError('INVALID_PERMISSIONS', 'At least one valid right is required.'));
    }

    const delegateCheck = this.authz.assertCanDelegate(cleanPerms);
    if (!delegateCheck.ok) return delegateCheck;

    await this.uow.transaction(async (tx) => {
      const nextName = cmd.name ? cmd.name.trim().toUpperCase() : role.name;
      const updateRole = sqlUpdate(StaffRoleTable)
        .set({
          name: nextName,
          description: cmd.description !== undefined ? cmd.description : undefined,
        })
        .withAuditBump(this.request.actorId)
        .whereEq(rCols.id, role.id)
        .whereNull(rCols.deletedAt)
        .compile();

      await tx.execute(updateRole);

      const pCols = StaffRolePermissionTable.cols;
      const existingPermsQuery = sqlSelect(StaffRolePermissionTable)
        .select([
          pCols.id,
        ])
        .whereEq(pCols.staffRoleId, role.id)
        .activeOnly()
        .compile();

      const existingPerms = await tx.queryMany(existingPermsQuery);

      for (const existing of existingPerms) {
        const delCmd = sqlSoftDelete(StaffRolePermissionTable, existing.id, this.request.actorId);
        await tx.execute(delCmd);
      }

      for (const perm of cleanPerms) {
        const insertPerm = sqlInsert(StaffRolePermissionTable)
          .values({
            staffRoleId: role.id,
            permission: perm,
            createdBy: this.request.actorId,
            updatedBy: this.request.actorId,
          })
          .compile();
        await tx.execute(insertPerm);
      }
    });

    // Zero-fan-out invalidation strictly post-commit: RolePermissionCache composes role + direct rules on read
    await this.rolePermissionCache.invalidateRole(role.id);
    return ok(undefined);
  }
}

export interface DeleteStaffRoleCommand extends Command<Result<void>> {
  readonly roleId: string;
}

export class DeleteStaffRoleHandler
  implements CommandHandler<DeleteStaffRoleCommand, Result<void>>
{
  private readonly uow: UnitOfWork;
  private readonly rolePermissionCache: RolePermissionCache;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    rolePermissionCache: RolePermissionCache,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.rolePermissionCache = rolePermissionCache;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: DeleteStaffRoleCommand): Promise<Result<void>> {
    const rCols = StaffRoleTable.cols;
    const roleQuery = sqlSelect(StaffRoleTable)
      .select([
        rCols.id,
        rCols.restaurantId,
        rCols.isSystemRole,
      ])
      .whereEq(rCols.id, cmd.roleId)
      .activeOnly()
      .compile();

    const role = await this.uow.queryOne(roleQuery);
    if (!role) {
      return err(new DomainError('ROLE_NOT_FOUND', `Role ${cmd.roleId} not found.`, 404));
    }

    const access = this.authz.assertRestaurantAccess(role.restaurantId, 'staff:roles:manage');
    if (!access.ok) return access;

    if (role.isSystemRole) {
      return err(
        new DomainError('SYSTEM_ROLE_LOCKED', 'Predefined system roles cannot be deleted.', 403),
      );
    }

    const aCols = StaffBranchAssignmentTable.cols;
    const assignedQuery = sqlSelect(StaffBranchAssignmentTable)
      .select([
        aCols.id,
      ])
      .whereEq(aCols.staffRoleId, role.id)
      .activeOnly()
      .take(1)
      .compile();

    if (await this.uow.exists(assignedQuery)) {
      return err(
        new DomainError(
          'ROLE_IN_USE',
          'Cannot delete role while active staff branch assignments use it.',
          409,
        ),
      );
    }

    const delCmd = sqlSoftDelete(StaffRoleTable, role.id, this.request.actorId);
    await this.uow.execute(delCmd);
    await this.rolePermissionCache.invalidateRole(role.id);
    return ok(undefined);
  }
}

export interface DirectPermissionRuleInput {
  readonly permission: TenantPermission;
  readonly effect?: PermissionEffect;
  readonly reason?: string;
  readonly validFrom?: string;
  readonly expiresAt?: string;
}

export interface AssignStaffBranchAccessCommand extends Command<Result<void>> {
  readonly staffId: string;
  readonly branchId: string;
  readonly roleId: string;
  readonly directPermissions?: readonly TenantPermission[];
  readonly directRules?: readonly DirectPermissionRuleInput[];
  readonly isPrimary?: boolean;
}

function mapRoleNameToLegacyEnum(roleName: string): TenantRole {
  if (roleName === 'OWNER' || roleName === 'BRAND_OWNER') return 'OWNER';
  if (roleName === 'OPERATIONAL_MANAGER') return 'ADMIN';
  if (roleName === 'BRANCH_MANAGER') return 'MANAGER';
  return 'ORDER_TAKER';
}

export class AssignStaffBranchAccessHandler
  implements CommandHandler<AssignStaffBranchAccessCommand, Result<void>>
{
  private readonly uow: UnitOfWork;
  private readonly rolePermissionCache: RolePermissionCache;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    rolePermissionCache: RolePermissionCache,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.rolePermissionCache = rolePermissionCache;
    this.authz = authz;
    this.request = request;
  }

  private normalizeDirectRules(cmd: AssignStaffBranchAccessCommand): {
    permission: TenantPermission;
    effect: PermissionEffect;
    reason: string | null;
    validFrom: Date | null;
    expiresAt: Date | null;
  }[] {
    const byPerm = new Map<
      TenantPermission,
      {
        permission: TenantPermission;
        effect: PermissionEffect;
        reason: string | null;
        validFrom: Date | null;
        expiresAt: Date | null;
      }
    >();

    for (const perm of sanitizePermissions(cmd.directPermissions ?? [])) {
      byPerm.set(perm, {
        permission: perm,
        effect: 'ALLOW',
        reason: null,
        validFrom: null,
        expiresAt: null,
      });
    }

    for (const rule of cmd.directRules ?? []) {
      if (!VALID_TENANT_PERMS.has(rule.permission)) continue;
      byPerm.set(rule.permission, {
        permission: rule.permission,
        effect: rule.effect ?? 'ALLOW',
        reason: rule.reason?.trim() ?? null,
        validFrom: rule.validFrom ? new Date(rule.validFrom) : null,
        expiresAt: rule.expiresAt ? new Date(rule.expiresAt) : null,
      });
    }

    return Array.from(byPerm.values());
  }

  // 2. Update `replaceStaffDirectRules` & `upsertAssignment` signatures to accept `tx: DbExecutor = this.uow` and execute on `tx`:
  private async replaceStaffDirectRules(
    staffId: string,
    branchId: string,
    rules: ReturnType<AssignStaffBranchAccessHandler['normalizeDirectRules']>,
    tx: DbExecutor = this.uow,
  ): Promise<void> {
    const dCols = StaffDirectPermissionTable.cols;
    const existingQ = sqlSelect(StaffDirectPermissionTable)
      .select([
        dCols.id,
      ])
      .whereEq(dCols.staffId, staffId)
      .whereEq(dCols.branchId, branchId)
      .activeOnly()
      .compile();
    const existingRows = await tx.queryMany(existingQ);

    for (const row of existingRows) {
      const del = sqlSoftDelete(StaffDirectPermissionTable, row.id, this.request.actorId);
      await tx.execute(del);
    }

    for (const rule of rules) {
      const ins = sqlInsert(StaffDirectPermissionTable)
        .values({
          staffId,
          branchId,
          permission: rule.permission,
          effect: rule.effect,
          reason: rule.reason,
          validFrom: rule.validFrom,
          expiresAt: rule.expiresAt,
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .compile();
      await tx.execute(ins);
    }
  }

  private async upsertAssignment(
    params: {
      staffId: string;
      branchId: string;
      roleId: string;
      isPrimary?: boolean;
    },
    tx: DbExecutor = this.uow,
  ): Promise<void> {
    const aCols = StaffBranchAssignmentTable.cols;
    const exQ = sqlSelect(StaffBranchAssignmentTable)
      .select([
        aCols.id,
      ])
      .whereEq(aCols.staffId, params.staffId)
      .whereEq(aCols.branchId, params.branchId)
      .activeOnly()
      .compile();
    const existing = await tx.queryOne(exQ);

    if (existing) {
      const upd = sqlUpdate(StaffBranchAssignmentTable)
        .set({
          staffRoleId: params.roleId,
          isPrimary: params.isPrimary,
        })
        .withAuditBump(this.request.actorId)
        .whereEq(aCols.id, existing.id)
        .whereNull(aCols.deletedAt)
        .compile();
      await tx.execute(upd);
      return;
    }

    const ins = sqlInsert(StaffBranchAssignmentTable)
      .values({
        staffId: params.staffId,
        branchId: params.branchId,
        staffRoleId: params.roleId,
        isPrimary: params.isPrimary ?? false,
        createdBy: this.request.actorId,
        updatedBy: this.request.actorId,
      })
      .compile();
    await tx.execute(ins);
  }
  async execute(cmd: AssignStaffBranchAccessCommand): Promise<Result<void>> {
    const sCols = RestaurantStaffTable.cols;
    const sQ = sqlSelect(RestaurantStaffTable)
      .select([
        sCols.id,
        sCols.restaurantId,
      ])
      .whereEq(sCols.id, cmd.staffId)
      .activeOnly()
      .compile();
    const staff = await this.uow.queryOne(sQ);
    if (!staff)
      return err(new DomainError('STAFF_NOT_FOUND', `Staff member ${cmd.staffId} not found.`, 404));

    const access = this.authz.assertRestaurantAccess(staff.restaurantId, 'staff:manage');
    if (!access.ok) return access;

    const branchId = cmd.branchId ?? this.request.branchId;
    if (!branchId) return err(new DomainError('MISSING_BRANCH', 'branchId is required.', 400));

    const bCols = RestaurantBranchTable.cols;
    const bQ = sqlSelect(RestaurantBranchTable)
      .select([
        bCols.id,
      ])
      .whereEq(bCols.id, branchId)
      .whereEq(bCols.restaurantId, staff.restaurantId)
      .activeOnly()
      .compile();
    const targetBranch = await this.uow.queryOne(bQ);
    if (!targetBranch)
      return err(
        new DomainError(
          'BRANCH_FORBIDDEN',
          `Branch ${branchId} does not belong to brand ${staff.restaurantId}.`,
          403,
        ),
      );

    const rCols = StaffRoleTable.cols;
    const rQ = sqlSelect(StaffRoleTable)
      .select([
        rCols.id,
        rCols.restaurantId,
        rCols.name,
      ])
      .whereEq(rCols.id, cmd.roleId)
      .activeOnly()
      .compile();
    const targetRole = await this.uow.queryOne(rQ);
    if (targetRole?.restaurantId !== staff.restaurantId) {
      return err(
        new DomainError('ROLE_NOT_FOUND', 'Target role does not exist in this brand.', 404),
      );
    }

    const rolePerms = await this.rolePermissionCache.getPermissionsForRole(targetRole.id);
    const normalizedRules = this.normalizeDirectRules(cmd);
    const allowDirectPerms = normalizedRules
      .filter((r) => r.effect === 'ALLOW')
      .map((r) => r.permission);

    // Ensure actor holds all rights being granted via role + direct ALLOW rules
    const delegateCheck = this.authz.assertCanDelegate([
      ...rolePerms,
      ...allowDirectPerms,
    ]);
    if (!delegateCheck.ok) return delegateCheck;

    // 3. In `AssignStaffBranchAccessHandler.execute` (bottom of method), wrap the 3 writes in `this.uow.transaction`:
    await this.uow.transaction(async (tx) => {
      await this.upsertAssignment(
        {
          staffId: staff.id,
          branchId: cmd.branchId,
          roleId: targetRole.id,
          isPrimary: cmd.isPrimary,
        },
        tx,
      );
      await this.replaceStaffDirectRules(staff.id, cmd.branchId, normalizedRules, tx);

      const updateStaff = sqlUpdate(RestaurantStaffTable)
        .set({
          roleId: targetRole.id,
          role: mapRoleNameToLegacyEnum(targetRole.name),
        })
        .withAuditBump(this.request.actorId)
        .whereEq(sCols.id, staff.id)
        .whereNull(sCols.deletedAt)
        .compile();
      await tx.execute(updateStaff);
    });

    await this.rolePermissionCache.invalidateStaffBranch(staff.id, cmd.branchId);
    return ok(undefined);
  }
}
