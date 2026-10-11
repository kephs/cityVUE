import type { RequestHandler } from 'express';

/**
 * Default for this dedicated API listener, including early errors and OPTIONS.
 * Register before body parsing/CORS; endpoint privacy middleware and controller
 * headers run later and retain authority over their specialized cache policy.
 * This does not configure the separately served React/static origin.
 */
export const apiCacheDefault: RequestHandler = (_request, response, next) => {
  if (!response.hasHeader('Cache-Control')) {
    response.setHeader('Cache-Control', 'no-store');
  }
  next();
};
