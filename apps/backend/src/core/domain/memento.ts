export interface Memento<TState> {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly version: number;
  readonly state: TState;
  readonly createdAt: Date;
}

export interface MementoOriginator<TState> {
  createMemento(): Memento<TState>;
  restoreFromMemento(memento: Memento<TState>): void;
}
