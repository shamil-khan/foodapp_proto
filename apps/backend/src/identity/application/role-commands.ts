import {
  type Pool,
  RestaurantStaffTable,
  StaffBranchAssignmentTable,
  StaffRolePermissionTable,
  StaffRoleTable,
  sqlInsert,
  sqlSelect,
  sqlSoftDelete,
  sqlUpdate,
  TENANT_PERMISSIONS,
  type TenantPermission,
  type TenantRole,
} from '@foodapp/db';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { RolePermissionCache } from '@/identity/infrastructure/role-permission-cache';

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
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
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

    const dupRes = await this.pool.query<typeof dupCheck._result>(dupCheck.text, dupCheck.params);
    if (dupRes.rows[0]) {
      return err(
        new DomainError('ROLE_EXISTS', `Role "${cleanName}" already exists in this brand.`, 409),
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

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

      const roleRes = await client.query<typeof insertRole._result>(
        insertRole.text,
        insertRole.params,
      );
      const createdRoleId = roleRes.rows[0]?.id;
      if (!createdRoleId) {
        throw new Error('Failed to create StaffRole record');
      }

      for (const perm of cleanPerms) {
        const insertPerm = sqlInsert(StaffRolePermissionTable)
          .values({
            staffRoleId: createdRoleId,
            permission: perm,
            createdBy: this.request.actorId,
            updatedBy: this.request.actorId,
          })
          .compile();
        await client.query(insertPerm.text, insertPerm.params);
      }

      await client.query('COMMIT');
      return ok({
        roleId: createdRoleId,
        name: cleanName,
        permissions: cleanPerms,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
  private readonly pool: Pool;
  private readonly rolePermissionCache: RolePermissionCache;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    pool: Pool,
    rolePermissionCache: RolePermissionCache,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.pool = pool;
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

    const roleRes = await this.pool.query<typeof roleQuery._result>(
      roleQuery.text,
      roleQuery.params,
    );
    const role = roleRes.rows[0];
    if (!role) {
      return err(new DomainError('ROLE_NOT_FOUND', `Role ${cmd.roleId} not found.`, 404));
    }

    const access = this.authz.assertRestaurantAccess(role.restaurantId, 'staff:roles:manage');
    if (!access.ok) return access;

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

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

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

      await client.query(updateRole.text, updateRole.params);

      const pCols = StaffRolePermissionTable.cols;
      const existingPermsQuery = sqlSelect(StaffRolePermissionTable)
        .select([
          pCols.id,
        ])
        .whereEq(pCols.staffRoleId, role.id)
        .activeOnly()
        .compile();

      const existingPerms = await client.query<typeof existingPermsQuery._result>(
        existingPermsQuery.text,
        existingPermsQuery.params,
      );

      for (const existing of existingPerms.rows) {
        const delCmd = sqlSoftDelete(StaffRolePermissionTable, existing.id, this.request.actorId);
        await client.query(delCmd.text, delCmd.params);
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
        await client.query(insertPerm.text, insertPerm.params);
      }

      await client.query('COMMIT');
      await this.rolePermissionCache.invalidateRole(role.id);
      return ok(undefined);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export interface DeleteStaffRoleCommand extends Command<Result<void>> {
  readonly roleId: string;
}

export class DeleteStaffRoleHandler
  implements CommandHandler<DeleteStaffRoleCommand, Result<void>>
{
  private readonly pool: Pool;
  private readonly rolePermissionCache: RolePermissionCache;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    pool: Pool,
    rolePermissionCache: RolePermissionCache,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.pool = pool;
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

    const roleRes = await this.pool.query<typeof roleQuery._result>(
      roleQuery.text,
      roleQuery.params,
    );
    const role = roleRes.rows[0];
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

    const assignedRes = await this.pool.query<typeof assignedQuery._result>(
      assignedQuery.text,
      assignedQuery.params,
    );
    if (assignedRes.rows[0]) {
      return err(
        new DomainError(
          'ROLE_IN_USE',
          'Cannot delete role while active staff branch assignments use it.',
          409,
        ),
      );
    }

    const delCmd = sqlSoftDelete(StaffRoleTable, role.id, this.request.actorId);
    await this.pool.query(delCmd.text, delCmd.params);
    await this.rolePermissionCache.invalidateRole(role.id);
    return ok(undefined);
  }
}

export interface AssignStaffBranchAccessCommand extends Command<Result<void>> {
  readonly staffId: string;
  readonly branchId: string;
  readonly roleId: string;
  readonly directPermissions?: readonly TenantPermission[];
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
  private readonly pool: Pool;
  private readonly rolePermissionCache: RolePermissionCache;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    pool: Pool,
    rolePermissionCache: RolePermissionCache,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.pool = pool;
    this.rolePermissionCache = rolePermissionCache;
    this.authz = authz;
    this.request = request;
  }

  private async upsertAssignment(params: {
    staffId: string;
    branchId: string;
    roleId: string;
    directPermissions: TenantPermission[];
    isPrimary?: boolean;
  }): Promise<void> {
    const aCols = StaffBranchAssignmentTable.cols;
    const exQ = sqlSelect(StaffBranchAssignmentTable)
      .select([
        aCols.id,
      ])
      .whereEq(aCols.staffId, params.staffId)
      .whereEq(aCols.branchId, params.branchId)
      .activeOnly()
      .compile();
    const existing = (await this.pool.query<typeof exQ._result>(exQ.text, exQ.params)).rows[0];

    if (existing) {
      const upd = sqlUpdate(StaffBranchAssignmentTable)
        .set({
          staffRoleId: params.roleId,
          directPermissions: params.directPermissions,
          isPrimary: params.isPrimary,
        })
        .withAuditBump(this.request.actorId)
        .whereEq(aCols.id, existing.id)
        .whereNull(aCols.deletedAt)
        .compile();
      await this.pool.query(upd.text, upd.params);
      return;
    }

    const ins = sqlInsert(StaffBranchAssignmentTable)
      .values({
        staffId: params.staffId,
        branchId: params.branchId,
        staffRoleId: params.roleId,
        directPermissions: params.directPermissions,
        isPrimary: params.isPrimary ?? false,
        createdBy: this.request.actorId,
        updatedBy: this.request.actorId,
      })
      .compile();
    await this.pool.query(ins.text, ins.params);
  }

  async execute(cmd: AssignStaffBranchAccessCommand): Promise<Result<void>> {
    const access = this.authz.assertBranchAccess(cmd.branchId, 'staff:manage');
    if (!access.ok) return access;

    const sCols = RestaurantStaffTable.cols;
    const sQ = sqlSelect(RestaurantStaffTable)
      .select([
        sCols.id,
        sCols.restaurantId,
      ])
      .whereEq(sCols.id, cmd.staffId)
      .activeOnly()
      .compile();
    const staff = (await this.pool.query<typeof sQ._result>(sQ.text, sQ.params)).rows[0];
    if (!staff)
      return err(new DomainError('STAFF_NOT_FOUND', `Staff member ${cmd.staffId} not found.`, 404));

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
    const targetRole = (await this.pool.query<typeof rQ._result>(rQ.text, rQ.params)).rows[0];
    if (targetRole?.restaurantId !== staff.restaurantId) {
      return err(
        new DomainError('ROLE_NOT_FOUND', 'Target role does not exist in this brand.', 404),
      );
    }

    const rolePerms = await this.rolePermissionCache.getPermissionsForRole(targetRole.id);
    const cleanDirect = sanitizePermissions(cmd.directPermissions ?? []);
    const delegateCheck = this.authz.assertCanDelegate([
      ...rolePerms,
      ...cleanDirect,
    ]);
    if (!delegateCheck.ok) return delegateCheck;

    await this.upsertAssignment({
      staffId: staff.id,
      branchId: cmd.branchId,
      roleId: targetRole.id,
      directPermissions: cleanDirect,
      isPrimary: cmd.isPrimary,
    });

    const updateStaff = sqlUpdate(RestaurantStaffTable)
      .set({
        roleId: targetRole.id,
        role: mapRoleNameToLegacyEnum(targetRole.name),
      })
      .withAuditBump(this.request.actorId)
      .whereEq(sCols.id, staff.id)
      .whereNull(sCols.deletedAt)
      .compile();
    await this.pool.query(updateStaff.text, updateStaff.params);

    await this.rolePermissionCache.invalidateStaffBranch(staff.id, cmd.branchId);
    return ok(undefined);
  }
}
