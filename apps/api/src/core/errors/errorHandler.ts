import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@vtmp/shared';
import { AppError } from './AppError';

export function toErrorBody(err: AppError): ApiErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details?.length ? { details: err.details } : {}),
    },
  };
}

export function fromZodError(err: ZodError): AppError {
  return AppError.unprocessable(
    'VALIDATION_FAILED',
    'The request contains invalid data',
    err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`, 'ROUTE_NOT_FOUND'));
};

/** Central error handler: every error leaves the API as { error: { code, message } }. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  let appError: AppError;
  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = fromZodError(err);
  } else if (bodyParserType(err)) {
    appError = fromBodyParserError(bodyParserType(err)!);
  } else {
    req.log?.error({ err }, 'unhandled error');
    appError = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  }
  res.status(appError.status).json(toErrorBody(appError));
};

/** express.json() errors carry a `type`; they are the client's fault, never a 500. */
function bodyParserType(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err)) return undefined;
  const type = (err as { type?: unknown }).type;
  return typeof type === 'string' && BODY_PARSER_ERRORS.has(type) ? type : undefined;
}

const BODY_PARSER_ERRORS = new Set([
  'entity.parse.failed',
  'entity.too.large',
  'encoding.unsupported',
  'charset.unsupported',
  'entity.verify.failed',
  'request.aborted',
  'request.size.invalid',
  'stream.encoding.set',
  'parameters.too.many',
]);

function fromBodyParserError(type: string): AppError {
  switch (type) {
    case 'entity.parse.failed':
      return AppError.badRequest('MALFORMED_JSON', 'Request body is not valid JSON');
    case 'entity.too.large':
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The request encoding is not supported');
    default:
      return AppError.badRequest('BAD_REQUEST_BODY', 'The request body could not be read');
  }
}
