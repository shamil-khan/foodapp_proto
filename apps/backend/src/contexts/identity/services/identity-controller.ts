import type { Context } from 'hono';
import type { AppEnv } from '@/container';
import type { ActiveActorProfileDto } from '@/contexts/identity/application/queries';
import type { PosStaffSessionClaims } from '@/contexts/identity/domain/auth-actor';
import { PosTokenService } from '@/contexts/identity/infrastructure/pos-token-service';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import type { DomainError, Result } from '@/core/domain/result';

export class IdentityController {
  private readonly posTokenService = new PosTokenService();

  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  async loginPosStaff(
    c: Context<AppEnv>,
    body: {
      email: string;
      password: string;
    },
  ) {
    const result = await this.commandBus.dispatch<Result<PosStaffSessionClaims, DomainError>>(
      'LoginPosStaff',
      {
        email: body.email,
        password: body.password,
      },
    );

    if (!result.ok) {
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        401,
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
        actor: profile,
      },
      200,
    );
  }
}
