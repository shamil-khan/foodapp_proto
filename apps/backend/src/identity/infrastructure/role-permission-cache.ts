import {
  ALL_PERMISSIONS,
  type Permission,
  type Pool,
  type redisClient,
  StaffRolePermissionTable,
  StaffRoleTable,
  sqlSelect,
} from '@foodapp/db';

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

  async getPermissionsForRole(roleId: string): Promise<readonly Permission[]> {
    const cacheKey = this.keyForRole(roleId);

    if (!this.redis.isOpen) {
      await this.redis.connect();
    }

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

  async invalidateRole(roleId: string): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
    await this.redis.del(this.keyForRole(roleId));
  }
}
