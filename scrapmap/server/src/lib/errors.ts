/** Error carrying an HTTP status so route handlers can throw instead of branching. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code ?? defaultCode(status);
    this.details = details;
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 422:
      return 'unprocessable';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'server_error' : 'error';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, 'bad_request', details);
export const unauthorized = (message = 'You must be signed in to do that.') =>
  new HttpError(401, message);
export const forbidden = (message = 'You do not have access to that.') =>
  new HttpError(403, message);
export const notFound = (message = 'Not found.') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const tooManyRequests = (message = 'Slow down a moment and try again.') =>
  new HttpError(429, message);
