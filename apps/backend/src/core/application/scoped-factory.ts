import type { RequestContext } from '@/core/application/authorization';

export interface ScopedInstance<TService> {
  readonly service: TService;
  dispose(): Promise<void>;
}

export type ScopedFactory<TService> = (request: RequestContext) => ScopedInstance<TService>;
