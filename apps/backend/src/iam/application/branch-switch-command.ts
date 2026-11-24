// FILE: apps/backend/src/iam/application/branch-switch-command.ts (Part 1 of 2)
import {
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
import type { PosStaffSessionClaims, StaffAssignedBranchDto } from '@/iam/domain/auth-actor';
import type { RolePermissionCache } from '@/iam/infrastructure/role-permission-cache';

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
    const sQ = sqlSelect(RestaurantStaffTable)
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
    const staff = (await this.pool.query<typeof sQ._result>(sQ.text, sQ.params)).rows[0];
    if (!staff) return err(new DomainError('UNAUTHORIZED', 'Staff record not found.', 401));

    const rCols = RestaurantTable.cols;
    const rQ = sqlSelect(RestaurantTable)
      .select([
        rCols.handle,
      ])
      .whereEq(rCols.id, staff.restaurantId)
      .activeOnly()
      .compile();
    const brandHandle =
      (await this.pool.query<typeof rQ._result>(rQ.text, rQ.params)).rows[0]?.handle ?? '';

    const aCols = StaffBranchAssignmentTable.cols;
    const aQ = sqlSelect(StaffBranchAssignmentTable)
      .select([
        aCols.branchId,
        aCols.staffRoleId,
        aCols.isPrimary,
      ])
      .whereEq(aCols.staffId, staff.id)
      .activeOnly()
      .compile();
    const assignments = (await this.pool.query<typeof aQ._result>(aQ.text, aQ.params)).rows;
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
    // FILE: apps/backend/src/iam/application/branch-switch-command.ts (Part 2 of 2)
    const bCols = RestaurantBranchTable.cols;
    const bQ = sqlSelect(RestaurantBranchTable)
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
    const branches = (await this.pool.query<typeof bQ._result>(bQ.text, bQ.params)).rows;
    const branchMap = new Map(
      branches.map((b) => [
        b.id,
        b,
      ]),
    );
    const targetBranch = branchMap.get(cmd.targetBranchId);
    if (!targetBranch) return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));

    const srCols = StaffRoleTable.cols;
    const srQ = sqlSelect(StaffRoleTable)
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
    const roleRows = (await this.pool.query<typeof srQ._result>(srQ.text, srQ.params)).rows;
    const roleMap = new Map(
      roleRows.map((r) => [
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

    const effectivePermissions =
      await this.rolePermissionCache.getEffectivePermissionsForStaffBranch(
        staff.id,
        targetBranch.id,
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
      permissions: effectivePermissions,
      assignedBranches,
    });
  }
}
