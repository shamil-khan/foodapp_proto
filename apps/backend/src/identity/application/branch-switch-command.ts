import {
  ALL_PERMISSIONS,
  type Permission,
  type Pool,
  RestaurantBranchTable,
  RestaurantStaffTable,
  RestaurantTable,
  StaffBranchAssignmentTable,
  StaffRoleTable,
  sqlSelect,
  type TenantRole,
} from '@foodapp/db';
import type { RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { PosStaffSessionClaims, StaffAssignedBranchDto } from '@/identity/domain/auth-actor';
import type { RolePermissionCache } from '@/identity/infrastructure/role-permission-cache';

const ALLOWED_PERM_SET = new Set<string>(ALL_PERMISSIONS);

export interface SwitchPosBranchCommand extends Command<Result<PosStaffSessionClaims>> {
  readonly targetBranchId: string;
}

export class SwitchPosBranchHandler
  implements CommandHandler<SwitchPosBranchCommand, Result<PosStaffSessionClaims>>
{
  private readonly pool: Pool;
  private readonly rolePermissionCache: RolePermissionCache;
  private readonly request: RequestContext;

  constructor(pool: Pool, rolePermissionCache: RolePermissionCache, request: RequestContext) {
    this.pool = pool;
    this.rolePermissionCache = rolePermissionCache;
    this.request = request;
  }

  async execute(cmd: SwitchPosBranchCommand): Promise<Result<PosStaffSessionClaims>> {
    if (this.request.actorSource !== 'POS_STAFF' || !this.request.restaurantId) {
      return err(new DomainError('UNAUTHORIZED', 'POS staff session required.', 401));
    }

    const sCols = RestaurantStaffTable.cols;
    const sRes = await this.pool.query(
      ...(() => {
        const q = sqlSelect(RestaurantStaffTable)
          .select([
            sCols.id,
            sCols.restaurantId,
            sCols.name,
            sCols.email,
            sCols.role,
          ])
          .whereEq(sCols.id, this.request.actorId)
          .activeOnly()
          .compile();
        return [
          q.text,
          q.params,
        ] as const;
      })(),
    );
    const staff = sRes.rows[0] as
      | {
          id: string;
          restaurantId: string;
          name: string;
          email: string;
          role: string;
        }
      | undefined;
    if (!staff) return err(new DomainError('UNAUTHORIZED', 'Staff record not found.', 401));

    const rCols = RestaurantTable.cols;
    const rRes = await this.pool.query(
      ...(() => {
        const q = sqlSelect(RestaurantTable)
          .select([
            rCols.handle,
          ])
          .whereEq(rCols.id, staff.restaurantId)
          .activeOnly()
          .compile();
        return [
          q.text,
          q.params,
        ] as const;
      })(),
    );
    const brandHandle =
      (
        rRes.rows[0] as
          | {
              handle: string;
            }
          | undefined
      )?.handle ?? '';

    const aCols = StaffBranchAssignmentTable.cols;
    const aRes = await this.pool.query(
      ...(() => {
        const q = sqlSelect(StaffBranchAssignmentTable)
          .select([
            aCols.branchId,
            aCols.staffRoleId,
            aCols.directPermissions,
            aCols.isPrimary,
          ])
          .whereEq(aCols.staffId, staff.id)
          .activeOnly()
          .compile();
        return [
          q.text,
          q.params,
        ] as const;
      })(),
    );
    const assignments = aRes.rows as {
      branchId: string;
      staffRoleId: string;
      directPermissions: string[];
      isPrimary: boolean;
    }[];
    const targetAssign = assignments.find((a) => a.branchId === cmd.targetBranchId);
    if (!targetAssign) {
      return err(
        new DomainError(
          'BRANCH_FORBIDDEN',
          'You do not have an active assignment on the target branch.',
          403,
        ),
      );
    }

    const bCols = RestaurantBranchTable.cols;
    const bRes = await this.pool.query(
      ...(() => {
        const q = sqlSelect(RestaurantBranchTable)
          .select([
            bCols.id,
            bCols.name,
            bCols.branchKey,
            bCols.city,
            bCols.cityKey,
          ])
          .whereIn(
            bCols.id,
            assignments.map((a) => a.branchId),
          )
          .activeOnly()
          .compile();
        return [
          q.text,
          q.params,
        ] as const;
      })(),
    );
    const branches = bRes.rows as {
      id: string;
      name: string;
      branchKey: string;
      city: string;
      cityKey: string;
    }[];
    const branchMap = new Map(
      branches.map((b) => [
        b.id,
        b,
      ]),
    );
    const targetBranch = branchMap.get(cmd.targetBranchId);
    if (!targetBranch) return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));

    const srCols = StaffRoleTable.cols;
    const srRes = await this.pool.query(
      ...(() => {
        const q = sqlSelect(StaffRoleTable)
          .select([
            srCols.id,
            srCols.name,
          ])
          .whereIn(
            srCols.id,
            assignments.map((a) => a.staffRoleId),
          )
          .activeOnly()
          .compile();
        return [
          q.text,
          q.params,
        ] as const;
      })(),
    );
    const roleMap = new Map(
      (
        srRes.rows as {
          id: string;
          name: string;
        }[]
      ).map((r) => [
        r.id,
        r.name,
      ]),
    );

    const assignedBranches: StaffAssignedBranchDto[] = assignments
      .map((a) => {
        const br = branchMap.get(a.branchId);
        if (!br) return null;
        return {
          branchId: br.id,
          branchName: br.name,
          branchKey: br.branchKey,
          city: br.city,
          cityKey: br.cityKey,
          roleId: a.staffRoleId,
          roleName: roleMap.get(a.staffRoleId) ?? staff.role,
          isPrimary: a.isPrimary,
        };
      })
      .filter((x): x is StaffAssignedBranchDto => x !== null);

    const rolePerms = await this.rolePermissionCache.getPermissionsForRole(
      targetAssign.staffRoleId,
    );
    const directPerms = (targetAssign.directPermissions ?? []).filter((p): p is Permission =>
      ALLOWED_PERM_SET.has(p),
    );
    const mergedPermissions = Array.from(
      new Set<Permission>([
        ...rolePerms,
        ...directPerms,
      ]),
    );

    return ok({
      staffId: staff.id,
      restaurantId: staff.restaurantId,
      brandHandle,
      activeBranchId: targetBranch.id,
      activeBranchKey: targetBranch.branchKey,
      roleId: targetAssign.staffRoleId,
      role: staff.role as TenantRole,
      name: staff.name,
      email: staff.email,
      permissions: mergedPermissions,
      assignedBranches,
    });
  }
}
