import { type Hook, z } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';

export const ValidationIssueSchema = z
  .object({
    path: z.string(),
    message: z.string(),
  })
  .openapi('ValidationIssue');

/**
 * Standardized 400 Bad Request envelope aligned with `Result<T, DomainError>` responses.
 */
export const ValidationErrorResponseSchema = z
  .object({
    code: z.literal('VALIDATION_ERROR'),
    error: z.string(),
    issues: z.array(ValidationIssueSchema),
  })
  .openapi('ValidationErrorResponse');

export const DomainErrorResponseSchema = z
  .object({
    code: z.string().optional(),
    error: z.string(),
  })
  .openapi('DomainErrorResponse');

export const SuccessFlagResponseSchema = z
  .object({
    success: z.literal(true),
  })
  .openapi('SuccessFlagResponse');

/**
 * Reusable pagination query parameters with Zod v4 numeric coercion (`?skip=0&take=20`).
 */
export const PaginationQuerySchema = z.object({
  skip: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .openapi({
      param: {
        name: 'skip',
        in: 'query',
      },
      example: 0,
    }),
  take: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      param: {
        name: 'take',
        in: 'query',
      },
      example: 20,
    }),
});

/**
 * Global OpenAPIHono `defaultHook` intercepting Zod validation errors before controllers execute.
 */
export const openApiValidationHook: Hook<unknown, AppEnv, string, Response | undefined> = (
  result,
  c,
) => {
  if (!result.success) {
    return c.json(
      {
        code: 'VALIDATION_ERROR' as const,
        error: 'Invalid request payload or parameters',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      400,
    );
  }
  return undefined;
};
