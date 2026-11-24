// FILE: apps/backend/src/iam/application/role-queries.ts (Part 1 of 2)
import {
  type Pool,
  StaffRolePermissionTable,
  StaffRoleTable,
  sqlSelect,
  TENANT_PERMISSION_CATALOG,
  TENANT_PERMISSIONS,
  type TenantPermission,
  type TenantPermissionCatalogEntry,
} from '@foodapp/db';
import type { AuthorizationPolicy } from '@/core/application/authorization';
import type { Query, QueryHandler } from '@/core/application/cqrs';
import { DomainError } from '@/core/domain/result';

export interface StaffRoleWithRightsDto {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissions: TenantPermission[];
}

export interface AssignableRightsResponseDto {
  readonly rights: readonly TenantPermission[];
  readonly catalog: readonly TenantPermissionCatalogEntry[];
}

export interface GetAssignablePermissionsQuery extends Query<AssignableRightsResponseDto> {}

export class GetAssignablePermissionsHandler
  implements QueryHandler<GetAssignablePermissionsQuery, AssignableRightsResponseDto>
{
  async execute(): Promise<AssignableRightsResponseDto> {
    return {
      rights: TENANT_PERMISSIONS,
      catalog: TENANT_PERMISSION_CATALOG,
    };
  }
}

export interface GetRestaurantStaffRolesQuery extends Query<StaffRoleWithRightsDto[]> {
  readonly restaurantId: string;
}

export class GetRestaurantStaffRolesHandler
  implements QueryHandler<GetRestaurantStaffRolesQuery, StaffRoleWithRightsDto[]>
{
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;

  constructor(pool: Pool, authz: AuthorizationPolicy) {
    this.pool = pool;
    this.authz = authz;
  }

  async execute(query: GetRestaurantStaffRolesQuery): Promise<StaffRoleWithRightsDto[]> {
    const access = this.authz.assertRestaurantAccess(query.restaurantId, 'staff:roles:manage');
    if (!access.ok) {
      throw new DomainError(access.error.code, access.error.message, 403);
    }

    const rCols = StaffRoleTable.cols;
    const rolesQuery = sqlSelect(StaffRoleTable)
      .select([
        rCols.id,
        rCols.restaurantId,
        rCols.name,
        rCols.description,
        rCols.isSystemRole,
      ])
      .whereEq(rCols.restaurantId, query.restaurantId)
      .activeOnly()
      .orderBy(rCols.name, 'ASC')
      .compile();

    const { rows: roles } = await this.pool.query<typeof rolesQuery._result>(
      rolesQuery.text,
      rolesQuery.params,
    );

    if (roles.length === 0) return [];
    // FILE: apps/backend/src/iam/application/role-queries.ts (Part 2 of 2)
    const pCols = StaffRolePermissionTable.cols;
    const permsQuery = sqlSelect(StaffRolePermissionTable)
      .select([
        pCols.staffRoleId,
        pCols.permission,
      ])
      .whereIn(
        pCols.staffRoleId,
        roles.map((r) => r.id),
      )
      .activeOnly()
      .compile();

    const { rows: permRows } = await this.pool.query<typeof permsQuery._result>(
      permsQuery.text,
      permsQuery.params,
    );

    const permsByRole = new Map<string, TenantPermission[]>();
    for (const row of permRows) {
      const list = permsByRole.get(row.staffRoleId) ?? [];
      list.push(row.permission as TenantPermission);
      permsByRole.set(row.staffRoleId, list);
    }

    return roles.map((r) => ({
      id: r.id,
      restaurantId: r.restaurantId,
      name: r.name,
      description: r.description,
      isSystemRole: r.isSystemRole,
      permissions: permsByRole.get(r.id) ?? [],
    }));
  }
}
