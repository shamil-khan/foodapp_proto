import type { DomainEvent } from '@/core/domain/domain-event';

export type DomainEventHandler<TEvent extends DomainEvent<unknown> = DomainEvent<unknown>> = (
  event: TEvent,
) => Promise<void>;

export interface EventBus {
  subscribe(eventType: string, handler: DomainEventHandler): void;
  unsubscribe(eventType: string, handler: DomainEventHandler): void;
  publish(events: readonly DomainEvent<unknown>[]): Promise<void>;
}

/**
 * In-memory EventBus for modular monolith.
 * Can be swapped for Redis Streams / RabbitMQ adapter when extracting microservices.
 */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, DomainEventHandler[]>();

  subscribe(eventType: string, handler: DomainEventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  unsubscribe(eventType: string, handler: DomainEventHandler): void {
    const existing = this.handlers.get(eventType);
    if (!existing) return;
    const next = existing.filter((h) => h !== handler);
    if (next.length === 0) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.set(eventType, next);
    }
  }

  async publish(events: readonly DomainEvent<unknown>[]): Promise<void> {
    for (const event of events) {
      const subscribers = this.handlers.get(event.eventType) ?? [];
      for (const handler of subscribers) {
        await handler(event);
      }
    }
  }
}
