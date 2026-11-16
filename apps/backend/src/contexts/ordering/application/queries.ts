import { OrderMilestoneLogTable, OrderTable, sqlSelect } from '@foodapp/db';
import type { Pool } from 'pg';
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
  constructor(
    private readonly pool: Pool,
    private readonly authz: AuthorizationPolicy,
  ) {}

  async execute(query: GetRestaurantOrdersQuery): Promise<PosOrderSummaryDto[]> {
    const access = this.authz.assertRestaurantAccess(query.restaurantId, 'orders:read');
    if (!access.ok) {
      throw new DomainError(access.error.code, access.error.message, 403);
    }

    const { cols } = OrderTable;
    const ordersQuery = sqlSelect(OrderTable)
      .select([
        cols.id,
        cols.restaurantId,
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
      .whereEq(cols.restaurantId, query.restaurantId)
      .activeOnly()
      .orderBy(cols.createdAt, 'DESC')
      .skip(query.skip ?? 0)
      .take(query.take ?? 25)
      .compile();

    const { rows: orderRows } = await this.pool.query<typeof ordersQuery._result>(
      ordersQuery.text,
      ordersQuery.params,
    );

    if (orderRows.length === 0) {
      return [];
    }

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
      if (!latestByOrder.has(m.orderId)) {
        latestByOrder.set(m.orderId, m.milestone);
      }
    }

    return orderRows.map((o) => ({
      ...o,
      latestMilestone: latestByOrder.get(o.id) ?? 'PLACED',
    }));
  }
}
