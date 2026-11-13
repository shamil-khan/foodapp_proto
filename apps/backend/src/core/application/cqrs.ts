import type { AppLogger } from '@/logger';

export interface Command<TResult = void> {
  readonly _resultType?: TResult;
}

export interface Query<TResult> {
  readonly _resultType?: TResult;
}

export interface CommandHandler<TCommand extends Command<TResult>, TResult = void> {
  execute(command: TCommand): Promise<TResult>;
}

export interface QueryHandler<TQuery extends Query<TResult>, TResult> {
  execute(query: TQuery): Promise<TResult>;
}

/**
 * GoF Decorator: Attaches structured AppLogger execution timing to any CommandHandler
 */
export class LoggingCommandHandlerDecorator<TCommand extends Command<TResult>, TResult = void>
  implements CommandHandler<TCommand, TResult>
{
  constructor(
    private readonly inner: CommandHandler<TCommand, TResult>,
    private readonly commandName: string,
    private readonly log: AppLogger,
  ) {}

  async execute(command: TCommand): Promise<TResult> {
    const start = performance.now();
    this.log.info`Executing command: ${this.commandName}`;
    try {
      const result = await this.inner.execute(command);
      const durationMs = (performance.now() - start).toFixed(2);
      this.log.info`Completed command: ${this.commandName} in ${durationMs}ms`;
      return result;
    } catch (error) {
      const durationMs = (performance.now() - start).toFixed(2);
      this.log.info`Failed command: ${this.commandName} after ${durationMs}ms`;
      throw error;
    }
  }
}

export interface CommandBus {
  register<TCommand extends Command<TResult>, TResult>(
    commandName: string,
    handler: CommandHandler<TCommand, TResult>,
  ): void;
  dispatch<TResult>(commandName: string, command: Command<TResult>): Promise<TResult>;
}

export interface QueryBus {
  register<TQuery extends Query<TResult>, TResult>(
    queryName: string,
    handler: QueryHandler<TQuery, TResult>,
  ): void;
  ask<TResult>(queryName: string, query: Query<TResult>): Promise<TResult>;
}

/**
 * GoF Mediator: Routes commands to handlers wrapped with LoggingCommandHandlerDecorator
 */
export class InMemoryCommandBus implements CommandBus {
  private readonly handlers = new Map<string, CommandHandler<Command<unknown>, unknown>>();

  constructor(private readonly log: AppLogger) {}

  register<TCommand extends Command<TResult>, TResult>(
    commandName: string,
    handler: CommandHandler<TCommand, TResult>,
  ): void {
    const decorated = new LoggingCommandHandlerDecorator(handler, commandName, this.log);
    this.handlers.set(commandName, decorated as CommandHandler<Command<unknown>, unknown>);
  }

  async dispatch<TResult>(commandName: string, command: Command<TResult>): Promise<TResult> {
    const handler = this.handlers.get(commandName);
    if (!handler) {
      throw new Error(`No CommandHandler registered for: ${commandName}`);
    }
    return (await handler.execute(command)) as TResult;
  }
}

/**
 * GoF Mediator: Routes read queries to QueryHandlers
 */
export class InMemoryQueryBus implements QueryBus {
  private readonly handlers = new Map<string, QueryHandler<Query<unknown>, unknown>>();

  register<TQuery extends Query<TResult>, TResult>(
    queryName: string,
    handler: QueryHandler<TQuery, TResult>,
  ): void {
    this.handlers.set(queryName, handler as QueryHandler<Query<unknown>, unknown>);
  }

  async ask<TResult>(queryName: string, query: Query<TResult>): Promise<TResult> {
    const handler = this.handlers.get(queryName);
    if (!handler) {
      throw new Error(`No QueryHandler registered for: ${queryName}`);
    }
    return (await handler.execute(query)) as TResult;
  }
}
