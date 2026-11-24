// FILE: apps/backend/src/brand/application/admin-brand-commands.ts
import { type KitchenType, type Pool, RestaurantTable, sqlUpdate } from '@foodapp/db';
import {
  type RegisterBrandCommand,
  RegisterBrandHandler,
} from '@/brand/application/brand-commands';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import type { EventBus } from '@/core/application/event-bus';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export interface CreateRestaurantByAdminCommand
  extends Command<
    Result<{
      restaurantId: string;
      brandHandle: string;
      branchId: string;
      ownerStaffId: string;
    }>
  > {
  readonly name: string;
  readonly handle: string;
  readonly kitchenType?: KitchenType;
  readonly isMultiBranchEnterprise?: boolean;
  readonly branchName?: string;
  readonly city: string;
  readonly postcodeSector: string;
  readonly streetAddress: string;
  readonly contactPersonName: string;
  readonly contactPersonPhone: string;
  readonly ownerName: string;
  readonly ownerEmail: string;
  readonly ownerPassword: string;
}

export class CreateRestaurantByAdminHandler
  implements
    CommandHandler<
      CreateRestaurantByAdminCommand,
      Result<{
        restaurantId: string;
        brandHandle: string;
        branchId: string;
        ownerStaffId: string;
      }>
    >
{
  private readonly pool: Pool;
  private readonly eventBus: EventBus;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, eventBus: EventBus, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
    this.eventBus = eventBus;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: CreateRestaurantByAdminCommand): Promise<
    Result<{
      restaurantId: string;
      brandHandle: string;
      branchId: string;
      ownerStaffId: string;
    }>
  > {
    const permCheck = this.authz.assertPermission('platform:restaurants:manage');
    if (!permCheck.ok) return permCheck;

    const registerHandler = new RegisterBrandHandler(this.pool, this.eventBus, this.request);
    const registerCmd: RegisterBrandCommand = {
      brandName: cmd.name,
      handle: cmd.handle,
      kitchenType: cmd.kitchenType ?? 'RESTAURANT_BRANCH',
      isMultiBranchEnterprise: cmd.isMultiBranchEnterprise,
      branchName: cmd.branchName ?? `${cmd.name} (${cmd.city})`,
      city: cmd.city,
      postcodeSector: cmd.postcodeSector,
      streetAddress: cmd.streetAddress,
      contactPersonName: cmd.contactPersonName,
      contactPersonPhone: cmd.contactPersonPhone,
      ownerName: cmd.ownerName,
      ownerEmail: cmd.ownerEmail,
      ownerPassword: cmd.ownerPassword,
    };

    const result = await registerHandler.execute(registerCmd);
    if (!result.ok) return result;

    return ok({
      restaurantId: result.value.restaurantId,
      brandHandle: result.value.brandHandle,
      branchId: result.value.branchId,
      ownerStaffId: result.value.ownerStaffId,
    });
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
      return err(new DomainError('RESTAURANT_NOT_FOUND', 'Restaurant brand not found.', 404));
    }

    return ok(undefined);
  }
}
