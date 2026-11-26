import * as crypto from 'node:crypto';
import {
  ANONYMOUS_ACTOR_ID,
  type Permission,
  type PlatformRole,
  type PlatformSupportScope,
  type TenantRole,
} from '@foodapp/db';
import { inferdiHono } from '@inferdi/hono';
import { createMiddleware } from 'hono/factory';
import { type AppEnv, type RequestContext, rootContainer } from '@/container';
import {
  type ActorSource,
  resolveDefaultPermissionsForActor,
} from '@/core/application/authorization';
import { auth } from '@/iam/infrastructure/better-auth';
import { PosTokenService } from '@/iam/infrastructure/pos-token-service';
import type { RolePermissionCache } from '@/iam/infrastructure/role-permission-cache';
import { AppLogger } from '@/logger';

const posTokenService = new PosTokenService();

export const initDiScope = inferdiHono<
  typeof rootContainer,
  AppEnv,
  ReturnType<typeof rootContainer.createScope>
>({
  container: rootContainer,
  createScope: async (root, c) => {
    const requestId = c.get('requestId') ?? c.req.header('X-Request-Id') ?? crypto.randomUUID();
    c.header('X-Request-Id', requestId);

    // Unauthenticated HTTP callers initialize strictly as ANONYMOUS with zero permissions
    let context: RequestContext = {
      requestId,
      actorId: ANONYMOUS_ACTOR_ID,
      actorSource: 'ANONYMOUS',
      permissions: [],
    };

    const posClaims = await posTokenService.verifyRequestToken(c);
    if (posClaims) {
      const roleCache: RolePermissionCache = root.get('rolePermissionCache');
      const livePermissions =
        posClaims.staffId && posClaims.activeBranchId
          ? await roleCache.getEffectivePermissionsForStaffBranch(
              posClaims.staffId,
              posClaims.activeBranchId,
            )
          : posClaims.permissions;

      context = {
        requestId,
        actorId: posClaims.staffId,
        actorSource: 'POS_STAFF',
        restaurantId: posClaims.restaurantId,
        branchId: posClaims.activeBranchId,
        roleId: posClaims.roleId,
        tenantRole: posClaims.role,
        permissions: resolveDefaultPermissionsForActor({
          actorSource: 'POS_STAFF',
          resolvedTenantPermissions: livePermissions,
        }),
      };
    } else {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });

      if (session?.user) {
        const userWithRole = session.user as {
          role?: string;
        };
        const dbRole = (userWithRole.role as PlatformRole) ?? 'CUSTOMER';
        // Corporate-email PLATFORM_ADMIN maps to PLATFORM_STAFF; Mobile+OTP CUSTOMER maps to CUSTOMER
        const actorSource: ActorSource =
          dbRole === 'PLATFORM_ADMIN' ? 'PLATFORM_STAFF' : 'CUSTOMER';
        context = {
          requestId,
          actorId: session.user.id,
          actorSource,
          permissions: resolveDefaultPermissionsForActor({
            actorSource,
          }),
        };
      }
    }

    return root.createScope({
      request: context,
      log: new AppLogger(requestId),
    });
  },
});

export const requireCustomer = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const request = c.var.di.get('request');

    if (request.actorSource === 'ANONYMOUS') {
      return c.json(
        {
          code: 'UNAUTHORIZED',
          error: 'Unauthorized: Customer session required',
        },
        401,
      );
    }

    if (request.actorSource !== 'CUSTOMER') {
      return c.json(
        {
          code: 'FORBIDDEN',
          error: 'Forbidden: Business staff accounts cannot act as customers',
        },
        403,
      );
    }

    await next();
  });

export const requirePlatformStaff = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const request = c.var.di.get('request');

    if (request.actorSource === 'ANONYMOUS') {
      return c.json(
        {
          code: 'UNAUTHORIZED',
          error: 'Unauthorized: Platform staff session required',
        },
        401,
      );
    }

    if (request.actorSource !== 'PLATFORM_STAFF') {
      return c.json(
        {
          code: 'FORBIDDEN',
          error: 'Forbidden: Platform staff privileges required',
        },
        403,
      );
    }

    await next();
  });

export const requirePosStaff = (allowedTenantRoles?: readonly TenantRole[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const request = c.var.di.get('request');

    if (request.actorSource === 'POS_STAFF' && request.tenantRole) {
      if (allowedTenantRoles && !allowedTenantRoles.includes(request.tenantRole)) {
        return c.json(
          {
            code: 'FORBIDDEN',
            error: 'Forbidden: Insufficient restaurant staff role',
          },
          403,
        );
      }
      await next();
      return;
    }

    return c.json(
      {
        code: 'UNAUTHORIZED',
        error: 'Unauthorized: POS staff shift login required',
      },
      401,
    );
  });

export const requirePermission = (permission: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const request = c.var.di.get('request');
    const authz = c.var.di.get('authz');

    if (request.actorSource === 'ANONYMOUS') {
      return c.json(
        {
          code: 'UNAUTHORIZED',
          error: 'Authentication required',
        },
        401,
      );
    }

    const check = authz.assertPermission(permission);
    if (!check.ok) {
      return c.json(
        {
          code: check.error.code,
          error: check.error.message,
        },
        403,
      );
    }

    await next();
  });

/**
 * Permits requests when the authenticated actor holds at least one of the listed permissions.
 */
export const requireAnyPermission = (...permissions: readonly Permission[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const request = c.var.di.get('request');
    const authz = c.var.di.get('authz');

    if (request.actorSource === 'ANONYMOUS') {
      return c.json(
        {
          code: 'UNAUTHORIZED',
          error: 'Authentication required',
        },
        401,
      );
    }

    const check = authz.assertAnyPermission(permissions);
    if (!check.ok) {
      return c.json(
        {
          code: check.error.code,
          error: check.error.message,
        },
        403,
      );
    }

    await next();
  });

type SupportTargetResolver = (c: {
  req: {
    param: (name: string) => string | undefined;
    query: (name: string) => string | undefined;
  };
}) => {
  readonly restaurantId?: string;
  readonly branchId?: string;
  readonly targetResourceId?: string;
};

async function verifyPlatformSupportTicket(params: {
  readonly c: Parameters<Parameters<typeof createMiddleware<AppEnv>>[0]>[0];
  readonly supportScope: PlatformSupportScope;
  readonly resolveTargetIds?: SupportTargetResolver;
}) {
  const { c } = params;
  const request = c.var.di.get('request');
  const authz = c.var.di.get('authz');

  const permCheck = authz.assertPermission(params.supportScope);
  if (!permCheck.ok) {
    return c.json(
      {
        code: permCheck.error.code,
        error: permCheck.error.message,
      },
      403,
    );
  }

  const ticketId = c.req.header('X-Support-Ticket-Id')?.trim();
  if (!ticketId) {
    return c.json(
      {
        code: 'SUPPORT_TICKET_REQUIRED',
        error: 'Platform support intervention requires an approved X-Support-Ticket-Id header.',
      },
      403,
    );
  }

  const targets = params.resolveTargetIds?.(c) ?? {};
  const grantRes = await c.var.di.get('supportAccessPort').validateAndAuditTicket({
    ticketId,
    platformUserId: request.actorId,
    requiredScope: params.supportScope,
    expectedRestaurantId: targets.restaurantId,
    expectedBranchId: targets.branchId,
    httpMethod: c.req.method,
    httpPath: c.req.path,
    targetResourceId: targets.targetResourceId,
  });

  if (!grantRes.ok) {
    return c.json(
      {
        code: grantRes.error.code,
        error: grantRes.error.message,
      },
      grantRes.error.statusCode === 404 ? 404 : 403,
    );
  }

  request.supportGrant = grantRes.value;
  return null;
}

/**
 * Enforces either a tenant actor holding one of `tenantPermissions`, OR a `PLATFORM_ADMIN`
 * holding `supportScope` AND presenting an approved, unexpired `X-Support-Ticket-Id` header.
 */
export const requireTenantOrSupportTicket = (params: {
  readonly tenantPermissions: readonly Permission[];
  readonly supportScope: PlatformSupportScope;
  readonly resolveTargetIds?: SupportTargetResolver;
}) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const request = c.var.di.get('request');
    const authz = c.var.di.get('authz');

    if (request.actorSource === 'ANONYMOUS') {
      return c.json(
        {
          code: 'UNAUTHORIZED',
          error: 'Authentication required',
        },
        401,
      );
    }

    if (authz.isPlatformAdmin()) {
      const errorResponse = await verifyPlatformSupportTicket({
        c,
        supportScope: params.supportScope,
        resolveTargetIds: params.resolveTargetIds,
      });
      if (errorResponse) return errorResponse;
      await next();
      return;
    }

    const check = authz.assertAnyPermission(params.tenantPermissions);
    if (!check.ok) {
      return c.json(
        {
          code: check.error.code,
          error: check.error.message,
        },
        403,
      );
    }

    await next();
  });
