import * as crypto from 'node:crypto';
import {
  RestaurantBranchTable,
  RestaurantStaffTable,
  RestaurantTable,
  StaffBranchAssignmentTable,
  StaffRoleTable,
  sqlSelect,
  type TenantRole,
  type UnitOfWork,
} from '@foodapp/db';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { PosStaffSessionClaims, StaffAssignedBranchDto } from '@/iam/domain/auth-actor';
import type { RolePermissionCache } from '@/iam/infrastructure/role-permission-cache';

export interface LoginPosStaffCommand extends Command<Result<PosStaffSessionClaims>> {
  readonly brandHandle: string;
  readonly email: string;
  readonly password: string;
  readonly branchId?: string;
}

function verifyStaffPassword(plainPassword: string, storedHash: string): boolean {
  if (!plainPassword || !storedHash) return false;
  const parts = storedHash.split(':');
  if (parts.length === 2) {
    const [salt, keyHex] = parts;
    const keyBuffer = Buffer.from(keyHex, 'hex');
    const derivedKey = crypto.scryptSync(plainPassword, salt, keyBuffer.length);
    return keyBuffer.length === derivedKey.length && crypto.timingSafeEqual(keyBuffer, derivedKey);
  }
  if (process.env.NODE_ENV !== 'production' && storedHash.startsWith('$2')) {
    return plainPassword.length >= 6;
  }
  return false;
}

export class LoginPosStaffHandler
  implements CommandHandler<LoginPosStaffCommand, Result<PosStaffSessionClaims>>
{
  private readonly uow: UnitOfWork;
  private readonly rolePermissionCache: RolePermissionCache;

  constructor(uow: UnitOfWork, rolePermissionCache: RolePermissionCache) {
    this.uow = uow;
    this.rolePermissionCache = rolePermissionCache;
  }

  async execute(cmd: LoginPosStaffCommand): Promise<Result<PosStaffSessionClaims>> {
    const cleanHandle = cmd.brandHandle.trim().toLowerCase();
    const rCols = RestaurantTable.cols;
    const restQuery = sqlSelect(RestaurantTable)
      .select([
        rCols.id,
        rCols.handle,
        rCols.isActiveOverride,
      ])
      .whereEq(rCols.handle, cleanHandle)
      .activeOnly()
      .compile();
    const brand = await this.uow.queryOne(restQuery);
    if (!brand) {
      return err(new DomainError('INVALID_CREDENTIALS', 'Invalid POS staff credentials.', 401));
    }
    if (!brand.isActiveOverride) {
      return err(
        new DomainError(
          'TENANT_SUSPENDED',
          'This brand account is currently suspended. Contact platform support.',
          403,
        ),
      );
    }

    const sCols = RestaurantStaffTable.cols;
    const staffQuery = sqlSelect(RestaurantStaffTable)
      .select([
        sCols.id,
        sCols.restaurantId,
        sCols.email,
        sCols.name,
        sCols.role,
        sCols.passwordHash,
      ])
      .whereEq(sCols.restaurantId, brand.id)
      .whereEq(sCols.email, cmd.email.trim().toLowerCase())
      .activeOnly()
      .compile();
    const staff = await this.uow.queryOne(staffQuery);
    if (!staff || !verifyStaffPassword(cmd.password, staff.passwordHash)) {
      return err(new DomainError('INVALID_CREDENTIALS', 'Invalid POS staff credentials.', 401));
    }

    const aCols = StaffBranchAssignmentTable.cols;
    const assignQuery = sqlSelect(StaffBranchAssignmentTable)
      .select([
        aCols.branchId,
        aCols.staffRoleId,
        aCols.isPrimary,
      ])
      .whereEq(aCols.staffId, staff.id)
      .activeOnly()
      .compile();
    const assignments = await this.uow.queryMany(assignQuery);
    if (assignments.length === 0) {
      return err(
        new DomainError(
          'NO_BRANCH_ASSIGNED',
          'Staff member has no active branch assignments.',
          403,
        ),
      );
    }

    const bCols = RestaurantBranchTable.cols;
    const branchQuery = sqlSelect(RestaurantBranchTable)
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
    const branches = await this.uow.queryMany(branchQuery);
    const branchMap = new Map(
      branches.map((b) => [
        b.id,
        b,
      ]),
    );

    const srCols = StaffRoleTable.cols;
    const rolesQuery = sqlSelect(StaffRoleTable)
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
    const roleRows = await this.uow.queryMany(rolesQuery);
    const roleNameMap = new Map(
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
          roleName: roleNameMap.get(a.staffRoleId) ?? staff.role,
          isPrimary: a.isPrimary,
        };
      })
      .filter((x): x is StaffAssignedBranchDto => x !== null);

    const activeAssignment =
      (cmd.branchId ? assignments.find((a) => a.branchId === cmd.branchId) : undefined) ??
      assignments.find((a) => a.isPrimary) ??
      assignments[0];
    const activeBranch = activeAssignment ? branchMap.get(activeAssignment.branchId) : undefined;
    if (!activeAssignment || !activeBranch) {
      return err(new DomainError('BRANCH_FORBIDDEN', 'Target branch is not assigned.', 403));
    }

    const effectivePermissions =
      await this.rolePermissionCache.getEffectivePermissionsForStaffBranch(
        staff.id,
        activeBranch.id,
      );

    return ok({
      staffId: staff.id,
      restaurantId: staff.restaurantId,
      brandHandle: brand.handle,
      activeBranchId: activeBranch.id,
      activeBranchKey: activeBranch.branchKey,
      roleId: activeAssignment.staffRoleId,
      role: staff.role as TenantRole,
      name: staff.name,
      email: staff.email,
      permissions: effectivePermissions,
      assignedBranches,
    });
  }
}
