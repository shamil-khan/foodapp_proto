// FILE: apps/backend/src/iam/infrastructure/role-permission-cache.ts (Part 1 of 2)
import {
  ALL_PERMISSIONS,
  type Permission,
  type PermissionEffect,
  type Pool,
  type redisClient,
  StaffBranchAssignmentTable,
  StaffDirectPermissionTable,
  StaffRolePermissionTable,
  StaffRoleTable,
  sqlSelect,
} from '@foodapp/db';
import {
  type DirectPermissionPolicyRule,
  evaluateEffectivePermissions,
} from '@/iam/domain/permission-evaluator';

type RedisClientType = typeof redisClient;

const ALLOWED_PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export class RolePermissionCache {
  private static readonly TTL_SECONDS = 3600;
  private readonly pool: Pool;
  private readonly redis: RedisClientType;

  constructor(pool: Pool, redis: RedisClientType) {
    this.pool = pool;
    this.redis = redis;
  }

  private keyForRole(roleId: string): string {
    return `role:perms:${roleId}`;
  }

  private keyForStaffDirectRules(staffId: string, branchId: string): string {
    return `staff:direct-rules:${staffId}:${branchId}`;
  }

  private async ensureRedisOpen(): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
  }

  async getPermissionsForRole(roleId: string): Promise<readonly Permission[]> {
    const cacheKey = this.keyForRole(roleId);
    await this.ensureRedisOpen();

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as Permission[];
    }

    const rCols = StaffRoleTable.cols;
    const roleCheck = sqlSelect(StaffRoleTable)
      .select([
        rCols.id,
      ])
      .whereEq(rCols.id, roleId)
      .activeOnly()
      .compile();

    const roleRes = await this.pool.query<typeof roleCheck._result>(
      roleCheck.text,
      roleCheck.params,
    );
    if (!roleRes.rows[0]) {
      return [];
    }

    const pCols = StaffRolePermissionTable.cols;
    const permQuery = sqlSelect(StaffRolePermissionTable)
      .select([
        pCols.permission,
      ])
      .whereEq(pCols.staffRoleId, roleId)
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof permQuery._result>(
      permQuery.text,
      permQuery.params,
    );

    const permissions = rows
      .map((r) => r.permission)
      .filter((perm): perm is Permission => ALLOWED_PERMISSION_SET.has(perm));

    await this.redis.set(cacheKey, JSON.stringify(permissions), {
      EX: RolePermissionCache.TTL_SECONDS,
    });

    return permissions;
  }
  // FILE: apps/backend/src/iam/infrastructure/role-permission-cache.ts (Part 2 of 2)
  async getDirectRulesForStaffBranch(
    staffId: string,
    branchId: string,
  ): Promise<readonly DirectPermissionPolicyRule[]> {
    const cacheKey = this.keyForStaffDirectRules(staffId, branchId);
    await this.ensureRedisOpen();

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as DirectPermissionPolicyRule[];
    }

    const dCols = StaffDirectPermissionTable.cols;
    const rulesQuery = sqlSelect(StaffDirectPermissionTable)
      .select([
        dCols.permission,
        dCols.effect,
        dCols.validFrom,
        dCols.expiresAt,
      ])
      .whereEq(dCols.staffId, staffId)
      .whereEq(dCols.branchId, branchId)
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof rulesQuery._result>(
      rulesQuery.text,
      rulesQuery.params,
    );

    const rules: DirectPermissionPolicyRule[] = rows.map((r) => ({
      permission: r.permission,
      effect: r.effect as PermissionEffect,
      validFrom: r.validFrom ? new Date(r.validFrom).toISOString() : null,
      expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
    }));

    await this.redis.set(cacheKey, JSON.stringify(rules), {
      EX: RolePermissionCache.TTL_SECONDS,
    });
    return rules;
  }

  /**
   * Composes cached role grants with cached per-staff ALLOW/DENY rules on read so
   * invalidating `role:perms:{roleId}` immediately updates every staff member on that role.
   */
  async getEffectivePermissionsForStaffBranch(
    staffId: string,
    branchId: string,
  ): Promise<readonly Permission[]> {
    const aCols = StaffBranchAssignmentTable.cols;
    const assignQuery = sqlSelect(StaffBranchAssignmentTable)
      .select([
        aCols.staffRoleId,
      ])
      .whereEq(aCols.staffId, staffId)
      .whereEq(aCols.branchId, branchId)
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof assignQuery._result>(
      assignQuery.text,
      assignQuery.params,
    );
    const assignment = rows[0];
    if (!assignment) {
      return [];
    }

    const [rolePerms, directRules] = await Promise.all([
      this.getPermissionsForRole(assignment.staffRoleId),
      this.getDirectRulesForStaffBranch(staffId, branchId),
    ]);

    return evaluateEffectivePermissions({
      rolePermissions: rolePerms,
      directRules,
    });
  }

  async invalidateRole(roleId: string): Promise<void> {
    await this.ensureRedisOpen();
    await this.redis.del(this.keyForRole(roleId));
  }

  async invalidateStaffBranch(staffId: string, branchId: string): Promise<void> {
    await this.ensureRedisOpen();
    await this.redis.del(this.keyForStaffDirectRules(staffId, branchId));
  }
}
