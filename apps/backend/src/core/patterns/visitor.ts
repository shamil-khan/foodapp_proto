export interface Visitable<TVisitor, TResult = void> {
  accept(visitor: TVisitor): TResult;
}
