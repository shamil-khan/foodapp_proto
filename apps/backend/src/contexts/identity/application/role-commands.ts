import {
  RestaurantStaffTable,
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
import type { Pool } from 'pg';
import type { RolePermissionCache } from '@/contexts/identity/infrastructure/role-permission-cache';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

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
  constructor(
    private readonly pool: Pool,
    private readonly authz: AuthorizationPolicy,
    private readonly request: RequestContext,
  ) {}

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
        new DomainError(
          'ROLE_EXISTS',
          `Role "${cleanName}" already exists in this restaurant.`,
          409,
        ),
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
  constructor(
    private readonly pool: Pool,
    private readonly rolePermissionCache: RolePermissionCache,
    private readonly authz: AuthorizationPolicy,
    private readonly request: RequestContext,
  ) {}

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

    if (role.isSystemRole && role.name === 'OWNER') {
      return err(
        new DomainError(
          'SYSTEM_ROLE_LOCKED',
          'The primary OWNER role cannot be edited or have its rights revoked.',
          403,
        ),
      );
    }

    const cleanPerms = sanitizePermissions(cmd.permissions);
    if (cleanPerms.length === 0) {
      return err(new DomainError('INVALID_PERMISSIONS', 'At least one valid right is required.'));
    }

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
  constructor(
    private readonly pool: Pool,
    private readonly rolePermissionCache: RolePermissionCache,
    private readonly authz: AuthorizationPolicy,
    private readonly request: RequestContext,
  ) {}

  async execute(cmd: DeleteStaffRoleCommand): Promise<Result<void>> {
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

    if (role.isSystemRole || role.name === 'OWNER') {
      return err(
        new DomainError('SYSTEM_ROLE_LOCKED', 'System-protected roles cannot be deleted.', 403),
      );
    }

    const sCols = RestaurantStaffTable.cols;
    const assignedQuery = sqlSelect(RestaurantStaffTable)
      .select([
        sCols.id,
      ])
      .whereEq(sCols.roleId, role.id)
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
          'Cannot delete role while active staff members are assigned to it.',
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

export interface AssignStaffRoleCommand extends Command<Result<void>> {
  readonly staffId: string;
  readonly roleId: string;
}

export class AssignStaffRoleHandler
  implements CommandHandler<AssignStaffRoleCommand, Result<void>>
{
  constructor(
    private readonly pool: Pool,
    private readonly authz: AuthorizationPolicy,
    private readonly request: RequestContext,
  ) {}

  async execute(cmd: AssignStaffRoleCommand): Promise<Result<void>> {
    const sCols = RestaurantStaffTable.cols;
    const staffQuery = sqlSelect(RestaurantStaffTable)
      .select([
        sCols.id,
        sCols.restaurantId,
      ])
      .whereEq(sCols.id, cmd.staffId)
      .activeOnly()
      .compile();

    const staffRes = await this.pool.query<typeof staffQuery._result>(
      staffQuery.text,
      staffQuery.params,
    );
    const staff = staffRes.rows[0];
    if (!staff) {
      return err(new DomainError('STAFF_NOT_FOUND', `Staff member ${cmd.staffId} not found.`, 404));
    }

    const access = this.authz.assertRestaurantAccess(staff.restaurantId, 'staff:manage');
    if (!access.ok) return access;

    const rCols = StaffRoleTable.cols;
    const roleQuery = sqlSelect(StaffRoleTable)
      .select([
        rCols.id,
        rCols.restaurantId,
        rCols.name,
      ])
      .whereEq(rCols.id, cmd.roleId)
      .activeOnly()
      .compile();

    const roleRes = await this.pool.query<typeof roleQuery._result>(
      roleQuery.text,
      roleQuery.params,
    );
    const targetRole = roleRes.rows[0];
    if (!targetRole || targetRole.restaurantId !== staff.restaurantId) {
      return err(
        new DomainError('ROLE_NOT_FOUND', 'Target role does not exist in this restaurant.', 404),
      );
    }

    const mappedEnum: TenantRole =
      targetRole.name === 'OWNER' ||
      targetRole.name === 'ADMIN' ||
      targetRole.name === 'MANAGER' ||
      targetRole.name === 'ORDER_TAKER'
        ? targetRole.name
        : 'ORDER_TAKER';

    const updateStaff = sqlUpdate(RestaurantStaffTable)
      .set({
        roleId: targetRole.id,
        role: mappedEnum,
      })
      .withAuditBump(this.request.actorId)
      .whereEq(sCols.id, staff.id)
      .whereNull(sCols.deletedAt)
      .compile();

    await this.pool.query(updateStaff.text, updateStaff.params);
    return ok(undefined);
  }
}
