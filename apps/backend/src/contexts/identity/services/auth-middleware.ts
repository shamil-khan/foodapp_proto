import * as crypto from 'node:crypto';
import { type PlatformRole, SYSTEM_ACTORS, type TenantRole } from '@foodapp/db';
import { inferdiHono } from '@inferdi/hono';
import { createMiddleware } from 'hono/factory';
import { type AppEnv, type RequestContext, rootContainer } from '@/container';
import { auth } from '@/contexts/identity/infrastructure/better-auth';
import { PosTokenService } from '@/contexts/identity/infrastructure/pos-token-service';
import { AppLogger } from '@/logger';

const posTokenService = new PosTokenService();

export const initDiScope = inferdiHono({
  container: rootContainer,
  createScope: async (root, c) => {
    const requestId = c.get('requestId') ?? c.req.header('X-Request-Id') ?? crypto.randomUUID();
    c.header('X-Request-Id', requestId);

    let context: RequestContext = {
      requestId,
      actorId: SYSTEM_ACTORS.SYSTEM_CRON,
      actorSource: 'SYSTEM',
    };

    const posClaims = await posTokenService.verifyRequestToken(c);
    if (posClaims) {
      context = {
        requestId,
        actorId: posClaims.staffId,
        actorSource: 'POS_STAFF',
        restaurantId: posClaims.restaurantId,
        tenantRole: posClaims.role,
      };
    } else {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });

      if (session?.user) {
        context = {
          requestId,
          actorId: session.user.id,
          actorSource: 'GLOBAL_USER',
          globalRole: (session.user.role as PlatformRole) ?? 'CUSTOMER',
        };
      }
    }

    return root.createScope({
      request: context,
      log: new AppLogger(requestId),
    });
  },
});

export const requireGlobalUser = (allowedRoles?: readonly PlatformRole[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const request = c.var.di.get('request');

    if (request.actorSource !== 'GLOBAL_USER' || !request.globalRole) {
      return c.json(
        {
          error: 'Unauthorized: Global user session required',
        },
        401,
      );
    }

    if (allowedRoles && !allowedRoles.includes(request.globalRole)) {
      return c.json(
        {
          error: 'Forbidden: Insufficient platform permissions',
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
            error: 'Forbidden: Insufficient restaurant staff role',
          },
          403,
        );
      }
      await next();
      return;
    }

    if (request.actorSource === 'GLOBAL_USER' && request.globalRole === 'PLATFORM_ADMIN') {
      await next();
      return;
    }

    return c.json(
      {
        error: 'Unauthorized: POS staff shift login required',
      },
      401,
    );
  });
