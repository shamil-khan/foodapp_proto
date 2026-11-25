import { LoyaltyLedgerTable, sqlSelect } from '@foodapp/db';
import type { AuthorizationPolicy } from '@/core/application/authorization';
import type { Query, QueryHandler } from '@/core/application/cqrs';
import { DomainError } from '@/core/domain/result';
import type { ReadRepository } from '@/core/infrastructure/read-repository';
import type { LoyaltyIssuerScope } from '@/loyalty/domain/loyalty-events';
import type { LoyaltyRepository } from '@/loyalty/infrastructure/loyalty-repository';

export interface CustomerLoyaltySummaryDto {
  readonly userId: string;
  readonly issuerScope: LoyaltyIssuerScope;
  readonly availablePoints: number;
  readonly heldPoints: number;
  readonly pendingMaturationPoints: number;
  readonly recentEntries: {
    readonly id: string;
    readonly orderId: string | null;
    readonly txType: string;
    readonly sourceType: string;
    readonly status: string;
    readonly pointsDelta: number;
    readonly maturesAt: string | null;
    readonly expiresAt: string | null;
    readonly createdAt: string;
  }[];
}

export interface GetCustomerLoyaltyQuery extends Query<CustomerLoyaltySummaryDto> {
  readonly userId: string;
  readonly issuerScope?: LoyaltyIssuerScope;
  readonly merchantId?: string;
}

export class GetCustomerLoyaltyHandler
  implements QueryHandler<GetCustomerLoyaltyQuery, CustomerLoyaltySummaryDto>
{
  private readonly readRepo: ReadRepository;
  private readonly repo: LoyaltyRepository;
  private readonly authz: AuthorizationPolicy;

  constructor(readRepo: ReadRepository, repo: LoyaltyRepository, authz: AuthorizationPolicy) {
    this.readRepo = readRepo;
    this.repo = repo;
    this.authz = authz;
  }

  async execute(query: GetCustomerLoyaltyQuery): Promise<CustomerLoyaltySummaryDto> {
    const access = this.authz.assertUserAccess(query.userId, 'loyalty:read');
    if (!access.ok) {
      throw new DomainError(access.error.code, access.error.message, 403);
    }

    const scope = query.issuerScope ?? 'PLATFORM';
    const wallet = await this.repo.loadWalletState({
      holderType: 'CUSTOMER',
      holderId: query.userId,
      issuerScope: scope,
      issuerMerchantId: scope === 'MERCHANT' ? (query.merchantId ?? null) : null,
    });

    const lCols = LoyaltyLedgerTable.cols;
    const builder = sqlSelect(LoyaltyLedgerTable)
      .select([
        lCols.id,
        lCols.orderId,
        lCols.txType,
        lCols.sourceType,
        lCols.status,
        lCols.pointsDelta,
        lCols.maturesAt,
        lCols.expiresAt,
        lCols.createdAt,
      ])
      .whereEq(lCols.holderType, 'CUSTOMER')
      .whereEq(lCols.holderId, query.userId)
      .whereEq(lCols.issuerScope, scope)
      .activeOnly();

    if (scope === 'MERCHANT' && query.merchantId) {
      builder.whereEq(lCols.issuerMerchantId, query.merchantId);
    } else {
      builder.whereNull(lCols.issuerMerchantId);
    }

    const q = builder.orderBy(lCols.createdAt, 'DESC').take(50).compile();

    const rows = await this.readRepo.findMany(q);
    return {
      userId: query.userId,
      issuerScope: scope,
      availablePoints: wallet.availablePoints,
      heldPoints: wallet.heldPoints,
      pendingMaturationPoints: wallet.pendingMaturationPoints,
      recentEntries: rows.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        txType: r.txType,
        sourceType: r.sourceType,
        status: r.status,
        pointsDelta: r.pointsDelta,
        maturesAt: r.maturesAt ? new Date(r.maturesAt).toISOString() : null,
        expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
    };
  }
}
