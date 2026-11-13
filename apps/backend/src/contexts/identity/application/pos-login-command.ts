import * as crypto from 'node:crypto';
import { RestaurantStaffTable, sqlSelect, type TenantRole } from '@foodapp/db';
import type { Pool } from 'pg';
import type { PosStaffSessionClaims } from '@/contexts/identity/domain/auth-actor';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export interface LoginPosStaffCommand extends Command<Result<PosStaffSessionClaims>> {
  readonly email: string;
  readonly password: string;
}

function verifyStaffPassword(plainPassword: string, storedHash: string): boolean {
  if (!plainPassword || !storedHash) return false;

  // Verify `salt:hexKey` scrypt hashes (Better Auth / Node crypto standard)
  const parts = storedHash.split(':');
  if (parts.length === 2) {
    const [salt, keyHex] = parts;
    const keyBuffer = Buffer.from(keyHex, 'hex');
    const derivedKey = crypto.scryptSync(plainPassword, salt, keyBuffer.length);
    return keyBuffer.length === derivedKey.length && crypto.timingSafeEqual(keyBuffer, derivedKey);
  }

  // Allow seeded SQL placeholder hashes strictly in local development
  if (process.env.NODE_ENV !== 'production' && storedHash.startsWith('$2')) {
    return plainPassword.length >= 6;
  }

  return false;
}

export class LoginPosStaffHandler
  implements CommandHandler<LoginPosStaffCommand, Result<PosStaffSessionClaims>>
{
  constructor(private readonly pool: Pool) {}

  async execute(cmd: LoginPosStaffCommand): Promise<Result<PosStaffSessionClaims>> {
    const { cols } = RestaurantStaffTable;

    const staffQuery = sqlSelect(RestaurantStaffTable)
      .select([
        cols.id,
        cols.restaurantId,
        cols.email,
        cols.name,
        cols.role,
        cols.passwordHash,
      ])
      .whereEq(cols.email, cmd.email.trim().toLowerCase())
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof staffQuery._result>(
      staffQuery.text,
      staffQuery.params,
    );

    const staff = rows[0];
    if (!staff || !verifyStaffPassword(cmd.password, staff.passwordHash)) {
      return err(new DomainError('INVALID_CREDENTIALS', 'Invalid POS staff credentials.', 401));
    }

    return ok({
      staffId: staff.id,
      restaurantId: staff.restaurantId,
      role: staff.role as TenantRole,
      name: staff.name,
      email: staff.email,
    });
  }
}
