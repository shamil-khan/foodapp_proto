import type { Permission } from '@foodapp/db';
import type { AuthorizationPolicy } from '@/core/application/authorization';
import { DomainError, err, type Result } from '@/core/domain/result';
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

export interface ExecutionAuthOptions {
  readonly requiredPermission?: Permission;
}

// GoF Pattern: Decorator — Cross-cutting timing/audit logger around command execution
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

// GoF Pattern: Decorator — Enforces required right before command execution
export class AuthorizingCommandHandlerDecorator<TCommand extends Command<TResult>, TResult = void>
  implements CommandHandler<TCommand, TResult>
{
  constructor(
    private readonly inner: CommandHandler<TCommand, TResult>,
    private readonly authz: AuthorizationPolicy,
    private readonly requiredPermission: Permission,
  ) {}

  async execute(command: TCommand): Promise<TResult> {
    const check = this.authz.assertPermission(this.requiredPermission);
    if (!check.ok) {
      return err(check.error) as unknown as TResult;
    }
    return this.inner.execute(command);
  }
}

// GoF Pattern: Decorator — Enforces required right before query execution
export class AuthorizingQueryHandlerDecorator<TQuery extends Query<TResult>, TResult>
  implements QueryHandler<TQuery, TResult>
{
  constructor(
    private readonly inner: QueryHandler<TQuery, TResult>,
    private readonly authz: AuthorizationPolicy,
    private readonly requiredPermission: Permission,
  ) {}

  async execute(query: TQuery): Promise<TResult> {
    const check = this.authz.assertPermission(this.requiredPermission);
    if (!check.ok) {
      throw new DomainError(check.error.code, check.error.message, 403);
    }
    return this.inner.execute(query);
  }
}
export interface CommandBus {
  register<TCommand extends Command<TResult>, TResult>(
    commandName: string,
    handler: CommandHandler<TCommand, TResult>,
    options?: ExecutionAuthOptions,
  ): void;
  dispatch<TResult extends Result<unknown, DomainError> | unknown>(
    commandName: string,
    command: Command<TResult>,
  ): Promise<TResult>;
}

export interface QueryBus {
  register<TQuery extends Query<TResult>, TResult>(
    queryName: string,
    handler: QueryHandler<TQuery, TResult>,
    options?: ExecutionAuthOptions,
  ): void;
  ask<TResult>(queryName: string, query: Query<TResult>): Promise<TResult>;
}

export class InMemoryCommandBus implements CommandBus {
  private readonly handlers = new Map<string, CommandHandler<Command<unknown>, unknown>>();

  constructor(
    private readonly log: AppLogger,
    private readonly authz?: AuthorizationPolicy,
  ) {}

  register<TCommand extends Command<TResult>, TResult>(
    commandName: string,
    handler: CommandHandler<TCommand, TResult>,
    options?: ExecutionAuthOptions,
  ): void {
    let wrapped: CommandHandler<TCommand, TResult> = handler;
    if (options?.requiredPermission && this.authz) {
      wrapped = new AuthorizingCommandHandlerDecorator(
        wrapped,
        this.authz,
        options.requiredPermission,
      );
    }
    const decorated = new LoggingCommandHandlerDecorator(wrapped, commandName, this.log);
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

export class InMemoryQueryBus implements QueryBus {
  private readonly handlers = new Map<string, QueryHandler<Query<unknown>, unknown>>();

  constructor(private readonly authz?: AuthorizationPolicy) {}

  register<TQuery extends Query<TResult>, TResult>(
    queryName: string,
    handler: QueryHandler<TQuery, TResult>,
    options?: ExecutionAuthOptions,
  ): void {
    let wrapped: QueryHandler<TQuery, TResult> = handler;
    if (options?.requiredPermission && this.authz) {
      wrapped = new AuthorizingQueryHandlerDecorator(
        wrapped,
        this.authz,
        options.requiredPermission,
      );
    }
    this.handlers.set(queryName, wrapped as QueryHandler<Query<unknown>, unknown>);
  }

  async ask<TResult>(queryName: string, query: Query<TResult>): Promise<TResult> {
    const handler = this.handlers.get(queryName);
    if (!handler) {
      throw new Error(`No QueryHandler registered for: ${queryName}`);
    }
    return (await handler.execute(query)) as TResult;
  }
}
