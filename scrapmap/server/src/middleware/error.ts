import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../env.ts';
import { HttpError } from '../lib/errors.ts';
import { UpstreamError } from '../lib/http.ts';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) return next(error);

  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'Some fields need fixing.',
        // Flatten to { fieldName: ['message'] } so forms can render inline errors.
        fields: error.issues.reduce<Record<string, string[]>>((acc, issue) => {
          const key = issue.path.join('.') || '_';
          (acc[key] ??= []).push(issue.message);
          return acc;
        }, {}),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof UpstreamError) {
    // A free third-party API being down is not the caller's fault, and it is
    // not a bug in this server either.
    res.status(503).json({
      error: {
        code: 'upstream_unavailable',
        message: 'A data source we rely on is unavailable right now. Try again shortly.',
        details: env.isProduction ? undefined : error.message,
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (!env.isTest) console.error('[scrapmap] unhandled error:', error);

  res.status(500).json({
    error: {
      code: 'server_error',
      message: 'Something went wrong on our end.',
      details: env.isProduction ? undefined : message,
    },
  });
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => unknown>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
