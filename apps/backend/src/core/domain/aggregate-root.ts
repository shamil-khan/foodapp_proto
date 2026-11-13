import * as crypto from 'node:crypto';
import type { DomainEvent, EventMetadata } from '@/core/domain/domain-event';
import type { Memento, MementoOriginator } from '@/core/domain/memento';

export abstract class AggregateRoot<TState> implements MementoOriginator<TState> {
  private uncommittedEvents: DomainEvent[] = [];
  protected _version = 0;

  constructor(
    public readonly id: string,
    public readonly aggregateType: string,
    protected state: TState,
  ) {}

  get version(): number {
    return this._version;
  }

  /**
   * Emits a new domain event, advances version, applies state transition, and queues for persistence.
   */
  protected raiseEvent<TPayload>(
    eventType: string,
    payload: TPayload,
    metadata: EventMetadata,
  ): void {
    const nextVersion = this._version + 1;
    const event: DomainEvent<TPayload> = {
      eventId: crypto.randomUUID(),
      aggregateId: this.id,
      aggregateType: this.aggregateType,
      eventType,
      version: nextVersion,
      occurredAt: new Date(),
      payload,
      metadata,
    };

    this.apply(event);
    this._version = nextVersion;
    this.uncommittedEvents.push(event);
  }

  /**
   * Rehydrates aggregate from an optional Memento checkpoint followed by subsequent historical events.
   */
  public loadFromHistory(events: readonly DomainEvent[], memento?: Memento<TState>): void {
    if (memento) {
      this.restoreFromMemento(memento);
    }

    for (const event of events) {
      if (event.version <= this._version) continue;
      this.apply(event);
      this._version = event.version;
    }
  }

  /**
   * Applies event to internal state. Pure informational/integration events may be intentional no-ops.
   */
  protected abstract apply(event: DomainEvent): void;

  public createMemento(): Memento<TState> {
    return {
      aggregateId: this.id,
      aggregateType: this.aggregateType,
      version: this._version,
      state: structuredClone(this.state),
      createdAt: new Date(),
    };
  }

  public restoreFromMemento(memento: Memento<TState>): void {
    this.state = structuredClone(memento.state);
    this._version = memento.version;
  }

  public pullDomainEvents(): DomainEvent[] {
    const events = [
      ...this.uncommittedEvents,
    ];
    this.uncommittedEvents = [];
    return events;
  }
}
