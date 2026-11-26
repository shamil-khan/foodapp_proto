import * as crypto from 'node:crypto';
import type { UnitOfWork } from '@foodapp/db';
import Decimal from 'decimal.js';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { CartLineInput } from '@/orders/application/cart-service';
import type { DeliveryProviderPort } from '@/orders/application/delivery-provider-port';
import { hydrateOrderLines, loadBranchPolicy } from '@/orders/application/order-pricing-helpers';
import { OrderAggregate } from '@/orders/domain/order-aggregate';
import type { OrderChannel, OrderPaymentMode, OrderStatus } from '@/orders/domain/order-events';
import { type KdsTicketOutput, KdsTicketVisitor } from '@/orders/domain/order-visitor';
import type { OrderRepository } from '@/orders/infrastructure/order-repository';

export interface PlacePosOrderCommand
  extends Command<
    Result<{
      readonly orderId: string;
      readonly kdsTickets: KdsTicketOutput;
    }>
  > {
  readonly restaurantId?: string;
  readonly diningTableId?: string;
  readonly customerId?: string;
  readonly orderSource: OrderChannel;
  readonly items: readonly CartLineInput[];
}

export class PlacePosOrderHandler
  implements
    CommandHandler<
      PlacePosOrderCommand,
      Result<{
        readonly orderId: string;
        readonly kdsTickets: KdsTicketOutput;
      }>
    >
{
  private readonly uow: UnitOfWork;
  private readonly orderRepo: OrderRepository;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    orderRepo: OrderRepository,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.orderRepo = orderRepo;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: PlacePosOrderCommand): Promise<
    Result<{
      readonly orderId: string;
      readonly kdsTickets: KdsTicketOutput;
    }>
  > {
    const branchId = this.request.branchId;
    if (!branchId) {
      return err(new DomainError('MISSING_BRANCH', 'Active branch session required.', 403));
    }
    const access = this.authz.assertBranchAccess(branchId, 'orders:place');
    if (!access.ok) return access;

    const branch = await loadBranchPolicy(this.uow, branchId);
    if (!branch) return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));

    const hydrated = await hydrateOrderLines(this.uow, branch, cmd.items);
    if (!hydrated.ok) return hydrated;

    const orderId = crypto.randomUUID();
    const aggRes = OrderAggregate.createOrder(
      orderId,
      {
        branchId: branch.id,
        restaurantId: branch.restaurantId,
        customerId: cmd.customerId,
        diningTableId: cmd.diningTableId,
        orderSource: cmd.orderSource,
        stateMachineCode: branch.stateMachineCode,
        paymentMode: 'CARD_TERMINAL',
        requiresOnlineCapture: false,
        lines: hydrated.value,
      },
      {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId: branch.restaurantId,
      },
    );
    if (!aggRes.ok) return aggRes;

    await this.orderRepo.save(aggRes.value);
    const kdsTickets = aggRes.value.accept(new KdsTicketVisitor()) as KdsTicketOutput;
    return ok({
      orderId,
      kdsTickets,
    });
  }
}

export interface TransitionOrderStatusCommand
  extends Command<
    Result<{
      readonly orderId: string;
      readonly status: OrderStatus;
      readonly rowVersion: number;
      readonly externalDeliveryId?: string;
    }>
  > {
  readonly orderId: string;
  readonly toStatus: OrderStatus;
  readonly expectedRowVersion?: number;
  readonly reason?: string;
}

export class TransitionOrderStatusHandler
  implements
    CommandHandler<
      TransitionOrderStatusCommand,
      Result<{
        readonly orderId: string;
        readonly status: OrderStatus;
        readonly rowVersion: number;
        readonly externalDeliveryId?: string;
      }>
    >
{
  private readonly uow: UnitOfWork;
  private readonly orderRepo: OrderRepository;
  private readonly deliveryProvider: DeliveryProviderPort;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    orderRepo: OrderRepository,
    deliveryProvider: DeliveryProviderPort,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
    this.orderRepo = orderRepo;
    this.deliveryProvider = deliveryProvider;
    this.authz = authz;
    this.request = request;
  }

  private authorizeTransition(order: OrderAggregate, toStatus: OrderStatus): Result<void> {
    if (this.request.actorSource === 'ANONYMOUS') {
      return err(new DomainError('UNAUTHORIZED', 'Authentication required.', 401));
    }
    if (this.request.actorSource === 'CUSTOMER') {
      if (order.snapshot.customerId !== this.request.actorId || toStatus !== 'CANCELLED') {
        return err(
          new DomainError('FORBIDDEN', 'Customers may only cancel their own active orders.', 403),
        );
      }
      return ok(undefined);
    }
    if (this.request.actorSource === 'PLATFORM_STAFF') {
      return this.authz.assertBranchAccess(
        order.snapshot.branchId,
        'orders:place',
        'platform:support:branch-override',
      );
    }
    return this.authz.assertBranchAccess(order.snapshot.branchId, 'orders:place');
  }

  private async dispatchExternalCourierIfNeeded(
    order: OrderAggregate,
    toStatus: OrderStatus,
  ): Promise<{
    deliveryProviderCode?: string;
    externalDeliveryId?: string;
    providerPayloadSnapshot?: Record<string, unknown>;
  }> {
    if (
      toStatus !== 'OUT_FOR_DELIVERY' ||
      order.snapshot.orderSource !== 'ONLINE_DELIVERY' ||
      order.snapshot.externalDeliveryId
    ) {
      return {};
    }

    const branch = await loadBranchPolicy(this.uow, order.snapshot.branchId);
    if (branch?.deliveryMode !== 'EXTERNAL_3PL') {
      return {};
    }

    const dispatch = await this.deliveryProvider.createDeliveryJob({
      orderId: order.id,
      branchId: branch.id,
      branchPostcodeSector: branch.postcodeSector,
      dropoffPostcodeSector: branch.postcodeSector,
      dropoffAddress: 'Customer Verified Address, UK',
      customerName: 'Storefront Customer',
      customerPhone: '+447700900001',
    });

    return {
      deliveryProviderCode: dispatch.providerCode,
      externalDeliveryId: dispatch.externalDeliveryId,
      providerPayloadSnapshot: dispatch.rawResponse,
    };
  }

  async execute(cmd: TransitionOrderStatusCommand): Promise<
    Result<{
      readonly orderId: string;
      readonly status: OrderStatus;
      readonly rowVersion: number;
      readonly externalDeliveryId?: string;
    }>
  > {
    const order = await this.orderRepo.findById(cmd.orderId);
    if (!order) return err(new DomainError('ORDER_NOT_FOUND', 'Order not found.', 404));

    const authCheck = this.authorizeTransition(order, cmd.toStatus);
    if (!authCheck.ok) return authCheck;

    const courierMeta = await this.dispatchExternalCourierIfNeeded(order, cmd.toStatus);

    const res = order.transitionTo(
      cmd.toStatus,
      {
        expectedRowVersion: cmd.expectedRowVersion,
        reason: cmd.reason,
        ...courierMeta,
      },
      {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId: order.snapshot.restaurantId,
      },
    );
    if (!res.ok) return res;

    await this.orderRepo.save(order);
    return ok({
      orderId: order.id,
      status: order.snapshot.status,
      rowVersion: order.version,
      externalDeliveryId: order.snapshot.externalDeliveryId,
    });
  }
}

export interface SettlePosOrderCommand extends Command<Result<void>> {
  readonly orderId: string;
  readonly paymentMethod: OrderPaymentMode;
  readonly tipAmount: number;
  readonly expectedRowVersion?: number;
}

export class SettlePosOrderHandler implements CommandHandler<SettlePosOrderCommand, Result<void>> {
  private readonly orderRepo: OrderRepository;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(orderRepo: OrderRepository, authz: AuthorizationPolicy, request: RequestContext) {
    this.orderRepo = orderRepo;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: SettlePosOrderCommand): Promise<Result<void>> {
    const order = await this.orderRepo.findById(cmd.orderId);
    if (!order) {
      return err(new DomainError('ORDER_NOT_FOUND', `Order ${cmd.orderId} not found.`, 404));
    }

    const access = this.authz.assertBranchAccess(order.snapshot.branchId, 'orders:settle');
    if (!access.ok) return access;

    const settleRes = order.settleBill(
      {
        paymentMode: cmd.paymentMethod,
        tipAmountGbp: new Decimal(cmd.tipAmount ?? 0),
        expectedRowVersion: cmd.expectedRowVersion,
      },
      {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId: order.snapshot.restaurantId,
      },
    );
    if (!settleRes.ok) return settleRes;

    await this.orderRepo.save(order);
    return ok(undefined);
  }
}
