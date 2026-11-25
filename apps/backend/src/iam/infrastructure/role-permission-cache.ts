import {
  ALL_PERMISSIONS,
  type Permission,
  type PermissionEffect,
  type redisClient,
  StaffBranchAssignmentTable,
  StaffDirectPermissionTable,
  StaffRolePermissionTable,
  StaffRoleTable,
  sqlSelect,
} from '@foodapp/db';
import type { ReadRepository } from '@/core/infrastructure/read-repository';
import {
  type DirectPermissionPolicyRule,
  evaluateEffectivePermissions,
} from '@/iam/domain/permission-evaluator';

type RedisClientType = typeof redisClient;

const ALLOWED_PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export class RolePermissionCache {
  private static readonly TTL_SECONDS = 3600;
  private readonly readRepo: ReadRepository;
  private readonly redis: RedisClientType;

  constructor(readRepo: ReadRepository, redis: RedisClientType) {
    this.readRepo = readRepo;
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

    if (!(await this.readRepo.exists(roleCheck))) {
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

    const rows = await this.readRepo.findMany(permQuery);

    const permissions = rows
      .map((r) => r.permission)
      .filter((perm): perm is Permission => ALLOWED_PERMISSION_SET.has(perm));

    await this.redis.set(cacheKey, JSON.stringify(permissions), {
      EX: RolePermissionCache.TTL_SECONDS,
    });

    return permissions;
  }

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

    const rows = await this.readRepo.findMany(rulesQuery);

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

    const assignment = await this.readRepo.findOne(assignQuery);
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
