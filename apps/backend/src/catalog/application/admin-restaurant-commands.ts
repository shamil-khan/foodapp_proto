import * as crypto from 'node:crypto';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PaymentConfigTable,
  type Pool,
  RestaurantLayoutTable,
  RestaurantStaffTable,
  RestaurantTable,
  StaffRolePermissionTable,
  StaffRoleTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
  type TenantRole,
} from '@foodapp/db';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

function hashStaffPassword(plainPassword: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(plainPassword, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export interface CreateRestaurantByAdminCommand
  extends Command<
    Result<{
      restaurantId: string;
      subdomain: string;
      ownerStaffId: string;
    }>
  > {
  readonly name: string;
  readonly subdomain: string;
  readonly postcodeSector: string;
  readonly ownerName: string;
  readonly ownerEmail: string;
  readonly ownerPassword: string;
  readonly platformFeeRate?: number;
}

export class CreateRestaurantByAdminHandler
  implements
    CommandHandler<
      CreateRestaurantByAdminCommand,
      Result<{
        restaurantId: string;
        subdomain: string;
        ownerStaffId: string;
      }>
    >
{
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: CreateRestaurantByAdminCommand): Promise<
    Result<{
      restaurantId: string;
      subdomain: string;
      ownerStaffId: string;
    }>
  > {
    const permCheck = this.authz.assertPermission('platform:restaurants:manage');
    if (!permCheck.ok) return permCheck;

    const cleanSubdomain = cmd.subdomain.trim().toLowerCase();
    const rCols = RestaurantTable.cols;

    const subDup = sqlSelect(RestaurantTable)
      .select([
        rCols.id,
      ])
      .whereEq(rCols.subdomain, cleanSubdomain)
      .compile();
    const subRes = await this.pool.query<typeof subDup._result>(subDup.text, subDup.params);
    if (subRes.rows[0]) {
      return err(
        new DomainError(
          'SUBDOMAIN_TAKEN',
          `Subdomain "${cleanSubdomain}" is already registered.`,
          409,
        ),
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const insertRest = sqlInsert(RestaurantTable)
        .values({
          name: cmd.name.trim(),
          subdomain: cleanSubdomain,
          postcodeSector: cmd.postcodeSector.trim().toUpperCase(),
          platformFeeRate: (cmd.platformFeeRate ?? 15.0).toFixed(2),
          isActiveOverride: true,
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .returning([
          rCols.id,
        ])
        .compile();

      const restRes = await client.query<typeof insertRest._result>(
        insertRest.text,
        insertRest.params,
      );
      const restaurantId = restRes.rows[0]?.id;
      if (!restaurantId) throw new Error('Failed to insert Restaurant');

      const insertLayout = sqlInsert(RestaurantLayoutTable)
        .values({
          restaurantId,
          templateId: 'uk_pos_modern_v1',
          primaryColor: '#1E293B',
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .compile();
      await client.query(insertLayout.text, insertLayout.params);

      const insertPayment = sqlInsert(PaymentConfigTable)
        .values({
          restaurantId,
          routingPolicy: 'CENTRAL_ESCROW',
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .compile();
      await client.query(insertPayment.text, insertPayment.params);
      const defaultRoles: readonly TenantRole[] = [
        'OWNER',
        'ADMIN',
        'MANAGER',
        'ORDER_TAKER',
      ];
      let ownerRoleId = '';

      for (const roleName of defaultRoles) {
        const srCols = StaffRoleTable.cols;
        const insertRole = sqlInsert(StaffRoleTable)
          .values({
            restaurantId,
            name: roleName,
            description: `Default ${roleName} role`,
            isSystemRole: roleName === 'OWNER',
            createdBy: this.request.actorId,
            updatedBy: this.request.actorId,
          })
          .returning([
            srCols.id,
          ])
          .compile();

        const roleRes = await client.query<typeof insertRole._result>(
          insertRole.text,
          insertRole.params,
        );
        const createdRoleId = roleRes.rows[0]?.id;
        if (!createdRoleId) throw new Error(`Failed to seed role ${roleName}`);
        if (roleName === 'OWNER') ownerRoleId = createdRoleId;

        for (const perm of DEFAULT_ROLE_PERMISSIONS[roleName]) {
          const insertPerm = sqlInsert(StaffRolePermissionTable)
            .values({
              staffRoleId: createdRoleId,
              permission: perm,
              createdBy: this.request.actorId,
              updatedBy: this.request.actorId,
            })
            .compile();
          await client.query(insertPerm.text, insertPerm.params);
        }
      }

      const sCols = RestaurantStaffTable.cols;
      const insertOwner = sqlInsert(RestaurantStaffTable)
        .values({
          restaurantId,
          email: cmd.ownerEmail.trim().toLowerCase(),
          passwordHash: hashStaffPassword(cmd.ownerPassword),
          name: cmd.ownerName.trim(),
          role: 'OWNER',
          roleId: ownerRoleId,
          createdBy: this.request.actorId,
          updatedBy: this.request.actorId,
        })
        .returning([
          sCols.id,
        ])
        .compile();

      const ownerRes = await client.query<typeof insertOwner._result>(
        insertOwner.text,
        insertOwner.params,
      );
      const ownerStaffId = ownerRes.rows[0]?.id;
      if (!ownerStaffId) throw new Error('Failed to create initial restaurant owner');

      await client.query('COMMIT');
      return ok({
        restaurantId,
        subdomain: cleanSubdomain,
        ownerStaffId,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export interface UpdateRestaurantStatusByAdminCommand extends Command<Result<void>> {
  readonly restaurantId: string;
  readonly isActive: boolean;
}

export class UpdateRestaurantStatusByAdminHandler
  implements CommandHandler<UpdateRestaurantStatusByAdminCommand, Result<void>>
{
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: UpdateRestaurantStatusByAdminCommand): Promise<Result<void>> {
    const permCheck = this.authz.assertPermission('platform:restaurants:manage');
    if (!permCheck.ok) return permCheck;

    const rCols = RestaurantTable.cols;
    const updateCmd = sqlUpdate(RestaurantTable)
      .set({
        isActiveOverride: cmd.isActive,
      })
      .withAuditBump(this.request.actorId)
      .whereEq(rCols.id, cmd.restaurantId)
      .whereNull(rCols.deletedAt)
      .compile();

    const res = await this.pool.query(updateCmd.text, updateCmd.params);
    if ((res.rowCount ?? 0) === 0) {
      return err(new DomainError('RESTAURANT_NOT_FOUND', 'Restaurant not found.', 404));
    }

    return ok(undefined);
  }
}
