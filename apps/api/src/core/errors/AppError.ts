export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 500 | 503;

export interface ErrorDetail {
  path: string;
  message: string;
}

/** An expected, client-facing error. Anything else becomes a 500 INTERNAL_ERROR. */
export class AppError extends Error {
  constructor(
    public readonly status: HttpErrorStatus,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(code: string, message: string) {
    return new AppError(400, code, message);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }
  static conflict(code: string, message: string, details?: ErrorDetail[]) {
    return new AppError(409, code, message, details);
  }
  static unprocessable(code: string, message: string, details?: ErrorDetail[]) {
    return new AppError(422, code, message, details);
  }
}
