import express, { type Express } from 'express';
import cors from 'cors';
import { env } from './env.ts';
import { attachUser } from './middleware/auth.ts';
import { errorHandler, notFoundHandler } from './middleware/error.ts';
import { authRouter } from './routes/auth.ts';
import { usersRouter } from './routes/users.ts';
import { listingsRouter } from './routes/listings.ts';
import { claimsRouter } from './routes/claims.ts';
import { messagesRouter } from './routes/messages.ts';
import { reviewsRouter } from './routes/reviews.ts';
import { communitiesRouter } from './routes/communities.ts';
import { notificationsRouter } from './routes/notifications.ts';
import { photosRouter } from './routes/photos.ts';
import { dataRouter } from './routes/data.ts';

export function createApp(): Express {
  const app = express();

  // Trust the first proxy hop so rate limiting keys on the real client IP
  // when deployed behind nginx, Caddy, or a platform router.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser callers send no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed.`));
      },
      credentials: true,
    }),
  );

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // The photo route parses its own raw body, so JSON parsing must not claim it.
  app.use(express.json({ limit: '1mb' }));

  // Express 5 leaves req.body undefined when a request carries no body at all.
  // Several endpoints take an entirely optional payload (claiming a listing,
  // marking notifications read), and those should not 422 on an empty POST.
  app.use((req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });

  app.use(attachUser);

  app.use(
    '/uploads',
    express.static(env.uploadDir, {
      maxAge: '7d',
      immutable: true,
      index: false,
      dotfiles: 'deny',
      setHeaders(res) {
        // Uploaded files are user content: never let a browser sniff them into
        // something executable.
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
      },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'scrapmap',
      offlineMode: env.offlineMode,
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/listings', listingsRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/communities', communitiesRouter);
  app.use('/api/notifications', notificationsRouter);

  // These routers own paths across more than one resource prefix.
  app.use('/api', claimsRouter);
  app.use('/api', messagesRouter);
  app.use('/api', photosRouter);
  app.use('/api', dataRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
