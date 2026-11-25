import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { CompiledQuery } from './sql-builder.ts';

export interface DbReader {
  queryOne<TResult>(query: CompiledQuery<TResult>): Promise<TResult | null>;
  queryMany<TResult>(query: CompiledQuery<TResult>): Promise<TResult[]>;
  exists(query: CompiledQuery<unknown>): Promise<boolean>;
}

export interface DbExecutor extends DbReader {
  execute(query: CompiledQuery<unknown>): Promise<number>;
  executeRaw(sql: string, params?: readonly unknown[]): Promise<number>;
}

export interface UnitOfWork extends DbExecutor {
  transaction<T>(work: (tx: DbExecutor) => Promise<T>): Promise<T>;
}

type QueryRunner = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

class PgQueryExecutor implements DbExecutor {
  protected readonly runner: QueryRunner;

  constructor(runner: QueryRunner) {
    this.runner = runner;
  }

  async queryOne<TResult>(query: CompiledQuery<TResult>): Promise<TResult | null> {
    const res = await this.runner.query<TResult & QueryResultRow>(query.text, [
      ...query.params,
    ]);
    return res.rows[0] ?? null;
  }

  async queryMany<TResult>(query: CompiledQuery<TResult>): Promise<TResult[]> {
    const res = await this.runner.query<TResult & QueryResultRow>(query.text, [
      ...query.params,
    ]);
    return res.rows;
  }

  async exists(query: CompiledQuery<unknown>): Promise<boolean> {
    const res = await this.runner.query(query.text, [
      ...query.params,
    ]);
    return (res.rowCount ?? res.rows.length) > 0;
  }

  async execute(query: CompiledQuery<unknown>): Promise<number> {
    const res = await this.runner.query(query.text, [
      ...query.params,
    ]);
    return res.rowCount ?? 0;
  }

  async executeRaw(sql: string, params: readonly unknown[] = []): Promise<number> {
    const res = await this.runner.query(sql, [
      ...params,
    ]);
    return res.rowCount ?? 0;
  }
}

export class PgDbReader implements DbReader {
  private readonly executor: PgQueryExecutor;

  constructor(pool: Pool) {
    this.executor = new PgQueryExecutor(pool);
  }

  queryOne<TResult>(query: CompiledQuery<TResult>): Promise<TResult | null> {
    return this.executor.queryOne(query);
  }

  queryMany<TResult>(query: CompiledQuery<TResult>): Promise<TResult[]> {
    return this.executor.queryMany(query);
  }

  exists(query: CompiledQuery<unknown>): Promise<boolean> {
    return this.executor.exists(query);
  }
}

export class PgUnitOfWork extends PgQueryExecutor implements UnitOfWork {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    super(pool);
    this.pool = pool;
  }

  async transaction<T>(work: (tx: DbExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txExecutor = new PgQueryExecutor(client);
      const result = await work(txExecutor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
