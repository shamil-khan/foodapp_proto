export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = 'DomainError';
  }
}

export type Result<T, E extends DomainError = DomainError> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly error: E;
    };

export const ok = <T>(value: T): Result<T, never> => ({
  ok: true,
  value,
});
export const err = <E extends DomainError>(error: E): Result<never, E> => ({
  ok: false,
  error,
});
