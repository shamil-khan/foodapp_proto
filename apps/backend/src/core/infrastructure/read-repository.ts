import { type AnyTable, type CompiledQuery, type DbReader, sqlSelect } from '@foodapp/db';

type RowOf<T extends AnyTable> = NonNullable<T['_row']>;
type ColKey<T extends AnyTable> = Extract<keyof T['cols'], string>;
type ColRef<T extends AnyTable> = T['cols'][ColKey<T>];

export class ReadRepository {
  private readonly db: DbReader;

  constructor(db: DbReader) {
    this.db = db;
  }

  async findById<
    T extends AnyTable & {
      readonly cols: {
        readonly id: ColRef<T>;
      };
    },
  >(table: T, id: string): Promise<RowOf<T> | null> {
    const builder = sqlSelect(table).whereEq(table.cols.id, id as never);
    if ('deletedAt' in table.cols) {
      builder.activeOnly();
    }
    const compiled = builder.take(1).compile();
    return (await this.db.queryOne(compiled)) as RowOf<T> | null;
  }

  findOne<TResult>(query: CompiledQuery<TResult>): Promise<TResult | null> {
    return this.db.queryOne(query);
  }

  findMany<TResult>(query: CompiledQuery<TResult>): Promise<TResult[]> {
    return this.db.queryMany(query);
  }

  exists(query: CompiledQuery<unknown>): Promise<boolean> {
    return this.db.exists(query);
  }
}
