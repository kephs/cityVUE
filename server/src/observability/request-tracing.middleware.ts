import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestTracing } from './request-tracing.js';

@Injectable()
export class RequestTracingMiddleware implements NestMiddleware {
  constructor(
    @Inject(RequestTracing) private readonly tracing: RequestTracing,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    // Disabled means no clock reads, listeners or request metadata access.
    if (!this.tracing.enabled) {
      next();
      return;
    }
    try {
      const startTime = new Date();
      const correlationId: unknown = (request as Request & { id?: unknown }).id;
      const method = request.method;
      let completed = false;
      const finish = (): void => {
        if (completed) return;
        completed = true;
        response.removeListener('finish', finish);
        response.removeListener('close', finish);
        try {
          // Express supplies the matched template after routing. Never read URL,
          // headers, params, query, body, identity or tenant context.
          const route: unknown = request.route;
          const routeTemplate: unknown =
            route && typeof route === 'object' && 'path' in route
              ? route.path
              : undefined;
          this.tracing.observe({
            startTime,
            endTime: new Date(),
            method,
            routeTemplate,
            statusCode: response.statusCode,
            aborted: !response.writableFinished,
            correlationId,
          });
        } catch {
          /* Telemetry must not affect the response or expose errors. */
        }
      };
      response.once('finish', finish);
      response.once('close', finish);
    } catch {
      /* Even telemetry setup failure must allow normal processing. */
    }
    next();
  }
}
