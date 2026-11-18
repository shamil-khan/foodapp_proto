export interface CompiledQuery<TResult = Record<string, unknown>> {
  readonly text: string;
  readonly params: unknown[];
  readonly _result: TResult;
}

export interface AnyTable {
  readonly table: string;
  readonly cols: Record<string, string>;
  readonly _row?: unknown;
  readonly _insert?: unknown;
}

type RowOf<T extends AnyTable> = NonNullable<T['_row']>;
type InsertOf<T extends AnyTable> = NonNullable<T['_insert']>;
type ColKey<T extends AnyTable> = Extract<keyof T['cols'], string>;
type ColRef<T extends AnyTable> = T['cols'][ColKey<T>];

/**
 * Extracts the TypeScript property key from a quoted column reference (`'"restaurantId"'` -> `'restaurantId'`)
 */
type KeyFromColRef<T extends AnyTable, TRef extends ColRef<T>> = {
  [K in ColKey<T>]: T['cols'][K] extends TRef ? K : never;
}[ColKey<T>];

class SelectBuilder<T extends AnyTable, TSelected extends ColKey<T> = ColKey<T>> {
  private readonly meta: T;
  private selectedCols: ColRef<T>[] = [];
  private readonly conditions: string[] = [];
  private readonly params: unknown[] = [];
  private readonly orderClauses: string[] = [];
  private limitVal?: number;
  private offsetVal?: number;

  constructor(meta: T) {
    this.meta = meta;
  }

  select<TRef extends ColRef<T>>(
    columns: readonly TRef[],
  ): SelectBuilder<T, KeyFromColRef<T, TRef>> {
    const next = this as unknown as SelectBuilder<T, KeyFromColRef<T, TRef>>;
    next.selectedCols = [
      ...columns,
    ];
    return next;
  }

  whereEq<TRef extends ColRef<T>>(colRef: TRef, value: RowOf<T>[KeyFromColRef<T, TRef>]): this {
    this.params.push(value);
    this.conditions.push(`${colRef} = $${this.params.length}`);
    return this;
  }

  whereNeq<TRef extends ColRef<T>>(colRef: TRef, value: RowOf<T>[KeyFromColRef<T, TRef>]): this {
    this.params.push(value);
    this.conditions.push(`${colRef} <> $${this.params.length}`);
    return this;
  }

  whereGt<TRef extends ColRef<T>>(colRef: TRef, value: RowOf<T>[KeyFromColRef<T, TRef>]): this {
    this.params.push(value);
    this.conditions.push(`${colRef} > $${this.params.length}`);
    return this;
  }

  whereIn<TRef extends ColRef<T>>(
    colRef: TRef,
    values: readonly RowOf<T>[KeyFromColRef<T, TRef>][],
  ): this {
    if (values.length === 0) {
      this.conditions.push('1 = 0');
      return this;
    }
    this.params.push(values);
    this.conditions.push(`${colRef} = ANY($${this.params.length})`);
    return this;
  }

  whereNull(colRef: ColRef<T>): this {
    this.conditions.push(`${colRef} IS NULL`);
    return this;
  }

  whereNotNull(colRef: ColRef<T>): this {
    this.conditions.push(`${colRef} IS NOT NULL`);
    return this;
  }

  whereILike(colRef: ColRef<T>, pattern: string): this {
    this.params.push(pattern);
    this.conditions.push(`${colRef} ILIKE $${this.params.length}`);
    return this;
  }

  activeOnly(): this {
    if ('deletedAt' in this.meta.cols) {
      this.conditions.push(`${this.meta.cols.deletedAt} IS NULL`);
    }
    return this;
  }

  orderBy(colRef: ColRef<T>, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderClauses.push(`${colRef} ${direction}`);
    return this;
  }

  skip(offset: number): this {
    this.offsetVal = Math.max(0, Math.floor(offset));
    return this;
  }

  take(limit: number): this {
    this.limitVal = Math.max(1, Math.floor(limit));
    return this;
  }

  paginate(page: number, pageSize: number): this {
    const safePage = Math.max(1, Math.floor(page));
    const safeSize = Math.max(1, Math.floor(pageSize));
    return this.skip((safePage - 1) * safeSize).take(safeSize);
  }

  compile(): CompiledQuery<Pick<RowOf<T>, TSelected>> {
    const colsSql =
      this.selectedCols.length > 0
        ? this.selectedCols.join(', ')
        : Object.values(this.meta.cols).join(', ');

    const parts = [
      `SELECT ${colsSql}`,
      `FROM ${this.meta.table}`,
    ];

    if (this.conditions.length > 0) {
      parts.push(`WHERE ${this.conditions.join(' AND ')}`);
    }
    if (this.orderClauses.length > 0) {
      parts.push(`ORDER BY ${this.orderClauses.join(', ')}`);
    }
    if (this.limitVal !== undefined) {
      this.params.push(this.limitVal);
      parts.push(`LIMIT $${this.params.length}`);
    }
    if (this.offsetVal !== undefined) {
      this.params.push(this.offsetVal);
      parts.push(`OFFSET $${this.params.length}`);
    }

    return {
      text: `${parts.join(' ')};`,
      params: this.params,
    } as CompiledQuery<Pick<RowOf<T>, TSelected>>;
  }
}

class InsertBuilder<T extends AnyTable, TReturning extends ColKey<T> = never> {
  private readonly meta: T;
  private rowValues?: InsertOf<T>;
  private returningCols: ColRef<T>[] = [];
  private conflictTarget?: ColRef<T> | readonly ColRef<T>[];

  constructor(meta: T) {
    this.meta = meta;
  }

  values(data: InsertOf<T>): this {
    this.rowValues = data;
    return this;
  }

  onConflictDoNothing(targetColRef: ColRef<T> | readonly ColRef<T>[]): this {
    this.conflictTarget = targetColRef;
    return this;
  }

  returning<TRef extends ColRef<T>>(
    columns: readonly TRef[],
  ): InsertBuilder<T, KeyFromColRef<T, TRef>> {
    const next = this as unknown as InsertBuilder<T, KeyFromColRef<T, TRef>>;
    next.returningCols = [
      ...columns,
    ];
    return next;
  }

  compile(): CompiledQuery<Pick<RowOf<T>, TReturning>> {
    if (!this.rowValues) {
      throw new Error(`sqlInsert(${this.meta.table}) requires .values(...) before .compile()`);
    }

    const entries = Object.entries(this.rowValues).filter(([, v]) => v !== undefined);
    const colNames = entries.map(([k]) => this.meta.cols[k as ColKey<T>]);
    const params = entries.map(([, v]) => v);
    const placeholders = params.map((_, idx) => `$${idx + 1}`);

    const parts = [
      `INSERT INTO ${this.meta.table} (${colNames.join(', ')})`,
      `VALUES (${placeholders.join(', ')})`,
    ];

    if (this.conflictTarget) {
      const targetSql = Array.isArray(this.conflictTarget)
        ? this.conflictTarget.join(', ')
        : this.conflictTarget;
      parts.push(`ON CONFLICT (${targetSql}) DO NOTHING`);
    }

    if (this.returningCols.length > 0) {
      parts.push(`RETURNING ${this.returningCols.join(', ')}`);
    }

    return {
      text: `${parts.join(' ')};`,
      params: params,
    } as CompiledQuery<Pick<RowOf<T>, TReturning>>;
  }
}

class UpdateBuilder<T extends AnyTable> {
  private readonly meta: T;
  private setValues?: Partial<RowOf<T>>;
  private bumpVersion = false;
  private readonly conditions: string[] = [];
  private readonly params: unknown[] = [];

  constructor(meta: T) {
    this.meta = meta;
  }

  set(data: Partial<RowOf<T>>): this {
    this.setValues = data;
    return this;
  }

  withAuditBump(actorId: string): this {
    this.bumpVersion = true;
    this.setValues = {
      ...this.setValues,
      updatedBy: actorId,
    } as Partial<RowOf<T>>;
    return this;
  }

  whereEq<TRef extends ColRef<T>>(colRef: TRef, value: RowOf<T>[KeyFromColRef<T, TRef>]): this {
    this.params.push(value);
    this.conditions.push(`${colRef} = $${this.params.length}`);
    return this;
  }

  whereNull(colRef: ColRef<T>): this {
    this.conditions.push(`${colRef} IS NULL`);
    return this;
  }

  compile(): CompiledQuery {
    if (!this.setValues) {
      throw new Error(`sqlUpdate(${this.meta.table}) requires .set(...) before .compile()`);
    }

    const entries = Object.entries(this.setValues).filter(([, v]) => v !== undefined);
    const setClauses: string[] = [];

    for (const [k, v] of entries) {
      this.params.push(v);
      setClauses.push(`${this.meta.cols[k as ColKey<T>]} = $${this.params.length}`);
    }

    if (this.bumpVersion && 'rowVersion' in this.meta.cols && 'updatedAt' in this.meta.cols) {
      setClauses.push(`${this.meta.cols.rowVersion} = ${this.meta.cols.rowVersion} + 1`);
      setClauses.push(`${this.meta.cols.updatedAt} = CURRENT_TIMESTAMP`);
    }

    const parts = [
      `UPDATE ${this.meta.table}`,
      `SET ${setClauses.join(', ')}`,
    ];

    if (this.conditions.length > 0) {
      parts.push(`WHERE ${this.conditions.join(' AND ')}`);
    }

    return {
      text: `${parts.join(' ')};`,
      params: this.params,
    } as CompiledQuery;
  }
}

export const sqlSelect = <T extends AnyTable>(meta: T) => new SelectBuilder(meta);
export const sqlInsert = <T extends AnyTable>(meta: T) => new InsertBuilder(meta);
export const sqlUpdate = <T extends AnyTable>(meta: T) => new UpdateBuilder(meta);

export const sqlSoftDelete = <T extends AnyTable>(
  meta: T,
  id: string,
  actorId: string,
  expectedRowVersion?: number,
): CompiledQuery => {
  const builder = new UpdateBuilder(meta)
    .set({
      deletedAt: new Date(),
      deletedBy: actorId,
    } as Partial<RowOf<T>>)
    .withAuditBump(actorId)
    .whereEq(meta.cols.id as ColRef<T>, id as RowOf<T>[KeyFromColRef<T, ColRef<T>>])
    .whereNull(meta.cols.deletedAt as ColRef<T>);

  if (expectedRowVersion !== undefined) {
    builder.whereEq(
      meta.cols.rowVersion as ColRef<T>,
      expectedRowVersion as RowOf<T>[KeyFromColRef<T, ColRef<T>>],
    );
  }

  return builder.compile();
};
