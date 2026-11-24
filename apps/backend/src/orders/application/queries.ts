import {
  DomainEventStoreTable,
  OrderLineItemTable,
  OrderMilestoneLogTable,
  OrderTable,
  type Pool,
  sqlSelect,
} from '@foodapp/db';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Query, QueryHandler } from '@/core/application/cqrs';
import { DomainError } from '@/core/domain/result';

export interface PosOrderSummaryDto {
  readonly id: string;
  readonly branchId: string;
  readonly restaurantId: string;
  readonly diningTableId: string | null;
  readonly orderSource: string;
  readonly status: string;
  readonly stateMachineCode: string;
  readonly paymentMethod: string;
  readonly subtotal: string;
  readonly vatTotal: string;
  readonly tipAmount: string;
  readonly totalAmount: string;
  readonly posReceiptNumber: string | null;
  readonly rowVersion: number;
  readonly latestMilestone: string;
  readonly createdAt: Date;
}

export interface GetRestaurantOrdersQuery extends Query<PosOrderSummaryDto[]> {
  readonly restaurantId: string;
  readonly skip?: number;
  readonly take?: number;
}

export class GetRestaurantOrdersHandler
  implements QueryHandler<GetRestaurantOrdersQuery, PosOrderSummaryDto[]>
{
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;

  constructor(pool: Pool, authz: AuthorizationPolicy) {
    this.pool = pool;
    this.authz = authz;
  }

  async execute(query: GetRestaurantOrdersQuery): Promise<PosOrderSummaryDto[]> {
    const access = this.authz.assertBranchAccess(query.restaurantId, 'orders:read');
    if (!access.ok) {
      throw new DomainError(access.error.code, access.error.message, 403);
    }

    const { cols } = OrderTable;
    const ordersQuery = sqlSelect(OrderTable)
      .select([
        cols.id,
        cols.branchId,
        cols.diningTableId,
        cols.orderSource,
        cols.status,
        cols.stateMachineCode,
        cols.paymentMethod,
        cols.subtotal,
        cols.vatTotal,
        cols.tipAmount,
        cols.totalAmount,
        cols.posReceiptNumber,
        cols.rowVersion,
        cols.createdAt,
      ])
      .whereEq(cols.branchId, query.restaurantId)
      .activeOnly()
      .orderBy(cols.createdAt, 'DESC')
      .skip(query.skip ?? 0)
      .take(query.take ?? 25)
      .compile();

    const { rows: orderRows } = await this.pool.query<typeof ordersQuery._result>(
      ordersQuery.text,
      ordersQuery.params,
    );
    if (orderRows.length === 0) return [];

    const mCols = OrderMilestoneLogTable.cols;
    const milestonesQuery = sqlSelect(OrderMilestoneLogTable)
      .select([
        mCols.orderId,
        mCols.milestone,
        mCols.createdAt,
      ])
      .whereIn(
        mCols.orderId,
        orderRows.map((o) => o.id),
      )
      .orderBy(mCols.createdAt, 'DESC')
      .compile();

    const { rows: milestoneRows } = await this.pool.query<typeof milestonesQuery._result>(
      milestonesQuery.text,
      milestonesQuery.params,
    );

    const latestByOrder = new Map<string, string>();
    for (const m of milestoneRows) {
      if (!latestByOrder.has(m.orderId)) latestByOrder.set(m.orderId, m.milestone);
    }

    return orderRows.map((o) => ({
      id: o.id,
      branchId: o.branchId,
      restaurantId: o.branchId,
      diningTableId: o.diningTableId,
      orderSource: o.orderSource,
      status: o.status,
      stateMachineCode: o.stateMachineCode,
      paymentMethod: o.paymentMethod,
      subtotal: o.subtotal,
      vatTotal: o.vatTotal,
      tipAmount: o.tipAmount,
      totalAmount: o.totalAmount,
      posReceiptNumber: o.posReceiptNumber,
      rowVersion: o.rowVersion,
      latestMilestone: latestByOrder.get(o.id) ?? 'PLACED',
      createdAt: o.createdAt,
    }));
  }
}

export interface OrderDetailDto {
  readonly id: string;
  readonly branchId: string;
  readonly customerId: string | null;
  readonly orderSource: string;
  readonly status: string;
  readonly stateMachineCode: string;
  readonly paymentMethod: string;
  readonly subtotal: string;
  readonly vatTotal: string;
  readonly deliveryFee: string;
  readonly loyaltyDiscountGbp: string;
  readonly totalAmount: string;
  readonly deliveryProviderCode: string | null;
  readonly externalDeliveryId: string | null;
  readonly providerPayloadSnapshot: Record<string, unknown> | null;
  readonly rowVersion: number;
  readonly items: readonly {
    readonly id: string;
    readonly menuItemId: string | null;
    readonly itemName: string;
    readonly quantity: number;
    readonly frozenPrice: string;
    readonly vatRateSnapshot: string;
    readonly vatAmountSnapshot: string;
    readonly allergenFlagsSnapshot: readonly string[];
    readonly modifiersSnapshot: unknown;
  }[];
}

export interface GetOrderByIdQuery extends Query<OrderDetailDto | null> {
  readonly orderId: string;
}

export class GetOrderByIdHandler implements QueryHandler<GetOrderByIdQuery, OrderDetailDto | null> {
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
    this.authz = authz;
    this.request = request;
  }

  async execute(query: GetOrderByIdQuery): Promise<OrderDetailDto | null> {
    const oCols = OrderTable.cols;
    const oQ = sqlSelect(OrderTable).whereEq(oCols.id, query.orderId).activeOnly().compile();
    const order = (await this.pool.query<typeof oQ._result>(oQ.text, oQ.params)).rows[0];
    if (!order) return null;

    if (this.request.actorSource === 'GLOBAL_USER' && !this.authz.isPlatformAdmin()) {
      if (order.customerId !== this.request.actorId) {
        throw new DomainError('FORBIDDEN', 'Order does not belong to current customer.', 403);
      }
    } else if (this.request.actorSource === 'POS_STAFF') {
      const access = this.authz.assertBranchAccess(order.branchId, 'orders:read');
      if (!access.ok) {
        throw new DomainError(access.error.code, access.error.message, 403);
      }
    }

    const liCols = OrderLineItemTable.cols;
    const liQ = sqlSelect(OrderLineItemTable)
      .whereEq(liCols.orderId, order.id)
      .activeOnly()
      .compile();
    const lines = (await this.pool.query<typeof liQ._result>(liQ.text, liQ.params)).rows;

    return {
      id: order.id,
      branchId: order.branchId,
      customerId: order.customerId,
      orderSource: order.orderSource,
      status: order.status,
      stateMachineCode: order.stateMachineCode,
      paymentMethod: order.paymentMethod,
      subtotal: order.subtotal,
      vatTotal: order.vatTotal,
      deliveryFee: order.deliveryFee,
      loyaltyDiscountGbp: order.loyaltyDiscountGbp,
      totalAmount: order.totalAmount,
      deliveryProviderCode: order.deliveryProviderCode,
      externalDeliveryId: order.externalDeliveryId,
      providerPayloadSnapshot: order.providerPayloadSnapshot,
      rowVersion: order.rowVersion,
      items: lines.map((l) => ({
        id: l.id,
        menuItemId: l.menuItemId,
        itemName: l.itemName,
        quantity: l.quantity,
        frozenPrice: l.frozenPrice,
        vatRateSnapshot: l.vatRateSnapshot,
        vatAmountSnapshot: l.vatAmountSnapshot,
        allergenFlagsSnapshot: l.allergenFlagsSnapshot ?? [],
        modifiersSnapshot: l.modifiersSnapshot,
      })),
    };
  }
}

export interface OrderStreamEventDto {
  readonly eventId: string;
  readonly version: number;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: string;
}

export interface GetOrderEventsSinceQuery extends Query<OrderStreamEventDto[]> {
  readonly orderId: string;
  readonly afterVersion: number;
}

export class GetOrderEventsSinceHandler
  implements QueryHandler<GetOrderEventsSinceQuery, OrderStreamEventDto[]>
{
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async execute(query: GetOrderEventsSinceQuery): Promise<OrderStreamEventDto[]> {
    const eCols = DomainEventStoreTable.cols;
    const q = sqlSelect(DomainEventStoreTable)
      .select([
        eCols.id,
        eCols.version,
        eCols.eventType,
        eCols.payload,
        eCols.occurredAt,
      ])
      .whereEq(eCols.aggregateId, query.orderId)
      .whereGt(eCols.version, query.afterVersion)
      .orderBy(eCols.version, 'ASC')
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
    return rows.map((r) => ({
      eventId: r.id,
      version: r.version,
      eventType: r.eventType,
      payload: r.payload,
      occurredAt: new Date(r.occurredAt).toISOString(),
    }));
  }
}
