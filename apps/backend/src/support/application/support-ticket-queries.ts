// FILE: apps/backend/src/support/application/support-ticket-queries.ts
import type { AuthorizationPolicy } from '@/core/application/authorization';
import type { Query, QueryHandler } from '@/core/application/cqrs';
import { DomainError } from '@/core/domain/result';
import type { SupportTicketRecord } from '@/support/domain/support-ticket';
import type { SupportTicketRepository } from '@/support/infrastructure/support-ticket-repository';

export interface ListBrandSupportTicketsQuery extends Query<readonly SupportTicketRecord[]> {
  readonly restaurantId: string;
}

export class ListBrandSupportTicketsHandler
  implements QueryHandler<ListBrandSupportTicketsQuery, readonly SupportTicketRecord[]>
{
  private readonly repo: SupportTicketRepository;
  private readonly authz: AuthorizationPolicy;

  constructor(repo: SupportTicketRepository, authz: AuthorizationPolicy) {
    this.repo = repo;
    this.authz = authz;
  }

  async execute(query: ListBrandSupportTicketsQuery): Promise<readonly SupportTicketRecord[]> {
    const access = this.authz.assertRestaurantAccess(query.restaurantId, 'brand:support:authorize');
    if (!access.ok) {
      throw new DomainError(access.error.code, access.error.message, 403);
    }

    return this.repo.listTicketsForRestaurant(query.restaurantId);
  }
}
