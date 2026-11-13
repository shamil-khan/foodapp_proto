export interface EventMetadata {
  readonly requestId?: string;
  readonly actorId: string;
  readonly restaurantId?: string;
}

export interface DomainEvent<TPayload = Record<string, unknown>> {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly eventType: string;
  readonly version: number;
  readonly occurredAt: Date;
  readonly payload: TPayload;
  readonly metadata: EventMetadata;
}
