import type { TenantPermission } from '@foodapp/db';
import type { Context } from 'hono';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import { DomainError, type Result } from '@/core/domain/result';
import type { ActiveActorProfileDto } from '@/identity/application/queries';
import type {
  AssignableRightsResponseDto,
  StaffRoleWithRightsDto,
} from '@/identity/application/role-queries';
import type { PosStaffSessionClaims } from '@/identity/domain/auth-actor';
import { PosTokenService } from '@/identity/infrastructure/pos-token-service';

function mapIdentityError(c: Context<AppEnv>, error: DomainError) {
  const payload = {
    code: error.code,
    error: error.message,
  };
  if (error.statusCode === 401) return c.json(payload, 401);
  if (error.statusCode === 403) return c.json(payload, 403);
  if (error.statusCode === 404) return c.json(payload, 404);
  if (error.statusCode === 409) return c.json(payload, 409);
  return c.json(payload, 400);
}

export class IdentityController {
  private readonly posTokenService = new PosTokenService();
  private readonly commandBus: CommandBus;
  private readonly queryBus: QueryBus;
  private readonly request: RequestContext;

  constructor(commandBus: CommandBus, queryBus: QueryBus, request: RequestContext) {
    this.commandBus = commandBus;
    this.queryBus = queryBus;
    this.request = request;
  }

  async loginPosStaff(
    c: Context<AppEnv>,
    body: {
      brandHandle: string;
      email: string;
      password: string;
      branchId?: string;
    },
  ) {
    const result = await this.commandBus.dispatch<Result<PosStaffSessionClaims, DomainError>>(
      'LoginPosStaff',
      body,
    );
    if (!result.ok) return mapIdentityError(c, result.error);

    const token = await this.posTokenService.issueShiftSession(c, result.value);
    return c.json(
      {
        success: true as const,
        token,
        staff: {
          ...result.value,
          permissions: [
            ...result.value.permissions,
          ],
          assignedBranches: [
            ...result.value.assignedBranches,
          ],
        },
      },
      200,
    );
  }

  async switchPosBranch(
    c: Context<AppEnv>,
    body: {
      targetBranchId: string;
    },
  ) {
    const result = await this.commandBus.dispatch<Result<PosStaffSessionClaims, DomainError>>(
      'SwitchPosBranch',
      body,
    );
    if (!result.ok) return mapIdentityError(c, result.error);

    const token = await this.posTokenService.issueShiftSession(c, result.value);
    return c.json(
      {
        success: true as const,
        token,
        staff: {
          ...result.value,
          permissions: [
            ...result.value.permissions,
          ],
          assignedBranches: [
            ...result.value.assignedBranches,
          ],
        },
      },
      200,
    );
  }

  logoutPosStaff(c: Context<AppEnv>) {
    this.posTokenService.clearShiftSession(c);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }

  async getCurrentActor(c: Context<AppEnv>) {
    const profile = await this.queryBus.ask<ActiveActorProfileDto | null>('GetCurrentActor', {});
    if (!profile) {
      return c.json(
        {
          error: 'Not authenticated',
        },
        401,
      );
    }

    return c.json(
      {
        actor: {
          ...profile,
          roleId: this.request.roleId,
          permissions: [
            ...this.request.permissions,
          ],
        },
      },
      200,
    );
  }

  async listAssignablePermissions(c: Context<AppEnv>) {
    try {
      const data = await this.queryBus.ask<AssignableRightsResponseDto>(
        'GetAssignablePermissions',
        {},
      );
      return c.json(
        {
          rights: [
            ...data.rights,
          ],
          catalog: [
            ...data.catalog,
          ] as unknown as Record<string, unknown>[],
        },
        200,
      );
    } catch (error) {
      if (error instanceof DomainError) return mapIdentityError(c, error);
      throw error;
    }
  }

  async listStaffRoles(
    c: Context<AppEnv>,
    query: {
      restaurantId?: string;
    },
  ) {
    const restaurantId = query.restaurantId ?? this.request.restaurantId;
    if (!restaurantId) {
      return c.json(
        {
          code: 'MISSING_TENANT',
          error: 'restaurantId is required',
        },
        403,
      );
    }

    try {
      const roles = await this.queryBus.ask<StaffRoleWithRightsDto[]>('GetRestaurantStaffRoles', {
        restaurantId,
      });
      return c.json(
        {
          roles,
        },
        200,
      );
    } catch (error) {
      if (error instanceof DomainError) return mapIdentityError(c, error);
      throw error;
    }
  }

  async createStaffRole(
    c: Context<AppEnv>,
    body: {
      restaurantId?: string;
      name: string;
      description?: string;
      permissions: TenantPermission[];
    },
  ) {
    const restaurantId = body.restaurantId ?? this.request.restaurantId;
    if (!restaurantId) {
      return c.json(
        {
          code: 'MISSING_TENANT',
          error: 'restaurantId is required',
        },
        403,
      );
    }

    const result = await this.commandBus.dispatch<
      Result<
        {
          roleId: string;
          name: string;
          permissions: TenantPermission[];
        },
        DomainError
      >
    >('CreateStaffRole', {
      restaurantId,
      name: body.name,
      description: body.description,
      permissions: body.permissions,
    });
    if (!result.ok) return mapIdentityError(c, result.error);
    return c.json(result.value, 201);
  }

  async updateStaffRole(
    c: Context<AppEnv>,
    params: {
      roleId: string;
    },
    body: {
      name?: string;
      description?: string | null;
      permissions: TenantPermission[];
    },
  ) {
    const result = await this.commandBus.dispatch<Result<void, DomainError>>('UpdateStaffRole', {
      roleId: params.roleId,
      name: body.name,
      description: body.description,
      permissions: body.permissions,
    });
    if (!result.ok) return mapIdentityError(c, result.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }

  async deleteStaffRole(
    c: Context<AppEnv>,
    params: {
      roleId: string;
    },
  ) {
    const result = await this.commandBus.dispatch<Result<void, DomainError>>('DeleteStaffRole', {
      roleId: params.roleId,
    });
    if (!result.ok) return mapIdentityError(c, result.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }

  async assignStaffBranchAccess(
    c: Context<AppEnv>,
    params: {
      staffId: string;
    },
    body: {
      branchId?: string;
      roleId: string;
      directPermissions?: TenantPermission[];
      isPrimary?: boolean;
    },
  ) {
    const branchId = body.branchId ?? this.request.branchId;
    if (!branchId) {
      return c.json(
        {
          code: 'MISSING_BRANCH',
          error: 'branchId is required',
        },
        403,
      );
    }

    const result = await this.commandBus.dispatch<Result<void, DomainError>>(
      'AssignStaffBranchAccess',
      {
        staffId: params.staffId,
        branchId,
        roleId: body.roleId,
        directPermissions: body.directPermissions,
        isPrimary: body.isPrimary,
      },
    );
    if (!result.ok) return mapIdentityError(c, result.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }
}
