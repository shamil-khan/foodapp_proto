import * as crypto from 'node:crypto';
import {
  DEFAULT_ROLE_PERMISSIONS,
  type Pool,
  RestaurantStaffTable,
  RestaurantTable,
  sqlSelect,
  type TenantRole,
} from '@foodapp/db';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { PosStaffSessionClaims } from '@/identity/domain/auth-actor';
import type { RolePermissionCache } from '@/identity/infrastructure/role-permission-cache';

export interface LoginPosStaffCommand extends Command<Result<PosStaffSessionClaims>> {
  readonly subdomain: string;
  readonly email: string;
  readonly password: string;
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
  private readonly pool: Pool;
  private readonly rolePermissionCache: RolePermissionCache;

  constructor(pool: Pool, rolePermissionCache: RolePermissionCache) {
    this.pool = pool;
    this.rolePermissionCache = rolePermissionCache;
  }

  async execute(cmd: LoginPosStaffCommand): Promise<Result<PosStaffSessionClaims>> {
    const cleanSubdomain = cmd.subdomain.trim().toLowerCase();
    const rCols = RestaurantTable.cols;

    const restQuery = sqlSelect(RestaurantTable)
      .select([
        rCols.id,
        rCols.subdomain,
        rCols.isActiveOverride,
      ])
      .whereEq(rCols.subdomain, cleanSubdomain)
      .activeOnly()
      .compile();

    const restRes = await this.pool.query<typeof restQuery._result>(
      restQuery.text,
      restQuery.params,
    );
    const restaurant = restRes.rows[0];
    if (!restaurant) {
      return err(new DomainError('INVALID_CREDENTIALS', 'Invalid POS staff credentials.', 401));
    }

    if (!restaurant.isActiveOverride) {
      return err(
        new DomainError(
          'TENANT_SUSPENDED',
          'This restaurant account is currently suspended. Contact platform support.',
          403,
        ),
      );
    }

    const { cols } = RestaurantStaffTable;
    const staffQuery = sqlSelect(RestaurantStaffTable)
      .select([
        cols.id,
        cols.restaurantId,
        cols.email,
        cols.name,
        cols.role,
        cols.roleId,
        cols.passwordHash,
      ])
      .whereEq(cols.restaurantId, restaurant.id)
      .whereEq(cols.email, cmd.email.trim().toLowerCase())
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof staffQuery._result>(
      staffQuery.text,
      staffQuery.params,
    );

    const staff = rows[0];
    if (!staff || !verifyStaffPassword(cmd.password, staff.passwordHash)) {
      return err(new DomainError('INVALID_CREDENTIALS', 'Invalid POS staff credentials.', 401));
    }

    const fallbackRole = staff.role as TenantRole;
    const resolvedPermissions = staff.roleId
      ? await this.rolePermissionCache.getPermissionsForRole(staff.roleId)
      : (DEFAULT_ROLE_PERMISSIONS[fallbackRole] ?? []);

    return ok({
      staffId: staff.id,
      restaurantId: staff.restaurantId,
      subdomain: restaurant.subdomain,
      roleId: staff.roleId ?? '',
      role: fallbackRole,
      name: staff.name,
      email: staff.email,
      permissions: resolvedPermissions,
    });
  }
}
