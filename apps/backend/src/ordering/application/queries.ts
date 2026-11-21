import { OrderMilestoneLogTable, OrderTable, type Pool, sqlSelect } from '@foodapp/db';
import type { AuthorizationPolicy } from '@/core/application/authorization';
import type { Query, QueryHandler } from '@/core/application/cqrs';
import { DomainError } from '@/core/domain/result';

export interface PosOrderSummaryDto {
  id: string;
  restaurantId: string;
  diningTableId: string | null;
  orderSource: string;
  paymentMethod: string;
  subtotal: string;
  vatTotal: string;
  tipAmount: string;
  totalAmount: string;
  rowVersion: number;
  latestMilestone: string;
  createdAt: Date;
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
        cols.paymentMethod,
        cols.subtotal,
        cols.vatTotal,
        cols.tipAmount,
        cols.totalAmount,
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
      restaurantId: o.branchId,
      diningTableId: o.diningTableId,
      orderSource: o.orderSource,
      paymentMethod: o.paymentMethod,
      subtotal: o.subtotal,
      vatTotal: o.vatTotal,
      tipAmount: o.tipAmount,
      totalAmount: o.totalAmount,
      rowVersion: o.rowVersion,
      latestMilestone: latestByOrder.get(o.id) ?? 'PLACED',
      createdAt: o.createdAt,
    }));
  }
}
