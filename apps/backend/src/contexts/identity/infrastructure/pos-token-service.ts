import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import type { PosStaffSessionClaims } from '@/contexts/identity/domain/auth-actor';

const POS_JWT_SECRET = process.env.BETTER_AUTH_SECRET ?? 'dev_pos_secret_change_in_prod';
const POS_COOKIE_NAME = 'pos_staff_token';
const SHIFT_TTL_SECONDS = 60 * 60 * 12; // 12-hour restaurant shift

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
      return {
        staffId: String(payload.staffId),
        restaurantId: String(payload.restaurantId),
        role: payload.role as PosStaffSessionClaims['role'],
        name: String(payload.name),
        email: String(payload.email),
      };
    } catch {
      return null;
    }
  }
}
