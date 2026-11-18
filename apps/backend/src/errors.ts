import type { StatusCode } from 'hono/utils/http-status';

export class AppError extends Error {
  public readonly status: StatusCode;
  public readonly errorCode: string;

  constructor(status: StatusCode, errorCode: string, message: string) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'RESOURCE_NOT_FOUND', message);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, 'BAD_REQUEST', message);
  }
}
