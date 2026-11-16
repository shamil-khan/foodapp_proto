import type { TenantPermission } from '@foodapp/db';
import type { Context } from 'hono';
import type { AppEnv, RequestContext } from '@/container';
import type { ActiveActorProfileDto } from '@/contexts/identity/application/queries';
import type { StaffRoleWithRightsDto } from '@/contexts/identity/application/role-queries';
import type { PosStaffSessionClaims } from '@/contexts/identity/domain/auth-actor';
import { PosTokenService } from '@/contexts/identity/infrastructure/pos-token-service';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import { DomainError, type Result } from '@/core/domain/result';

export class IdentityController {
  private readonly posTokenService = new PosTokenService();

  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly request: RequestContext,
  ) {}

  async loginPosStaff(
    c: Context<AppEnv>,
    body: {
      subdomain: string;
      email: string;
      password: string;
    },
  ) {
    const result = await this.commandBus.dispatch<Result<PosStaffSessionClaims, DomainError>>(
      'LoginPosStaff',
      {
        subdomain: body.subdomain,
        email: body.email,
        password: body.password,
      },
    );

    if (!result.ok) {
      const status = result.error.statusCode === 403 ? 403 : 401;
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        status,
      );
    }

    const token = await this.posTokenService.issueShiftSession(c, result.value);
    return c.json(
      {
        success: true as const,
        token,
        staff: result.value,
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
      const rights = await this.queryBus.ask<readonly TenantPermission[]>(
        'GetAssignablePermissions',
        {},
      );
      return c.json(
        {
          rights: [
            ...rights,
          ],
        },
        200,
      );
    } catch (error) {
      if (error instanceof DomainError && error.statusCode === 403) {
        return c.json(
          {
            code: error.code,
            error: error.message,
          },
          403,
        );
      }
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
      if (error instanceof DomainError && error.statusCode === 403) {
        return c.json(
          {
            code: error.code,
            error: error.message,
          },
          403,
        );
      }
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

    if (!result.ok) {
      const status =
        result.error.statusCode === 403 ? 403 : result.error.statusCode === 409 ? 409 : 400;
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        status,
      );
    }

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

    if (!result.ok) {
      const status =
        result.error.statusCode === 403 ? 403 : result.error.statusCode === 404 ? 404 : 400;
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        status,
      );
    }

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

    if (!result.ok) {
      const status =
        result.error.statusCode === 403
          ? 403
          : result.error.statusCode === 404
            ? 404
            : result.error.statusCode === 409
              ? 409
              : 400;
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        status,
      );
    }

    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }

  async assignStaffRole(
    c: Context<AppEnv>,
    params: {
      staffId: string;
    },
    body: {
      roleId: string;
    },
  ) {
    const result = await this.commandBus.dispatch<Result<void, DomainError>>('AssignStaffRole', {
      staffId: params.staffId,
      roleId: body.roleId,
    });

    if (!result.ok) {
      const status =
        result.error.statusCode === 403 ? 403 : result.error.statusCode === 404 ? 404 : 400;
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        status,
      );
    }

    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }
}
