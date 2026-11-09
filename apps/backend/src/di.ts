import type { InferdiHonoScopeEnv } from '@inferdi/hono';
import { Container } from '@inferdi/inferdi';

type RequestContext = {
  requestId: string;
  userId?: string;
};

// temporary class to demonstrate how to use the request context in a scoped service
class Users {
  constructor(readonly request: RequestContext) {}

  profile(id: string) {
    return {
      id,
      userId: this.request.userId,
    };
  }
}

export const rootContainer = new Container()
  .declareScopeInputs<{
    request: RequestContext;
  }>()
  .registerClass(
    'users',
    Users,
    [
      'request',
    ],
    'scoped',
  );

export const openRequestScope = (requestId: string, userId?: string) =>
  rootContainer.createScope({
    request: {
      requestId,
      userId,
    },
  });
export type RequestScope = ReturnType<typeof openRequestScope>;
export type AppEnv = InferdiHonoScopeEnv<RequestScope>;
