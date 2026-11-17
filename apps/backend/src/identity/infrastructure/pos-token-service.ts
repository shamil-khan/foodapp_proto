import { ALL_PERMISSIONS, type Permission } from '@foodapp/db';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import type { PosStaffSessionClaims } from '@/identity/domain/auth-actor';

const POS_JWT_SECRET = process.env.BETTER_AUTH_SECRET ?? 'dev_pos_secret_change_in_prod';
const POS_COOKIE_NAME = 'pos_staff_token';
const SHIFT_TTL_SECONDS = 60 * 60 * 12;
const ALLOWED_PERMS = new Set<string>(ALL_PERMISSIONS);

export class PosTokenService {
  async issueShiftSession(c: Context, claims: PosStaffSessionClaims): Promise<string> {
    const token = await sign(
      {
        ...claims,
        exp: Math.floor(Date.now() / 1000) + SHIFT_TTL_SECONDS,
      },
      POS_JWT_SECRET,
      'HS256',
    );

    setCookie(c, POS_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SHIFT_TTL_SECONDS,
    });

    return token;
  }

  clearShiftSession(c: Context): void {
    deleteCookie(c, POS_COOKIE_NAME, {
      path: '/',
    });
  }

  async verifyRequestToken(c: Context): Promise<PosStaffSessionClaims | null> {
    const rawToken =
      getCookie(c, POS_COOKIE_NAME) ?? c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');

    if (!rawToken) {
      return null;
    }

    try {
      const payload = await verify(rawToken, POS_JWT_SECRET, 'HS256');
      const rawPerms = Array.isArray(payload.permissions) ? payload.permissions : [];
      const permissions = rawPerms
        .map(String)
        .filter((perm): perm is Permission => ALLOWED_PERMS.has(perm));

      return {
        staffId: String(payload.staffId),
        restaurantId: String(payload.restaurantId),
        subdomain: String(payload.subdomain ?? ''),
        roleId: String(payload.roleId ?? ''),
        role: payload.role as PosStaffSessionClaims['role'],
        name: String(payload.name),
        email: String(payload.email),
        permissions,
      };
    } catch {
      return null;
    }
  }
}
