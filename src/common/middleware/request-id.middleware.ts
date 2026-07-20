import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';
const acceptedRequestIdPattern = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Adds a correlation identifier to every request and response.
 * A caller-provided value is accepted only when it matches a conservative
 * character and length policy; otherwise a server-generated UUID is used.
 */
export function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const providedRequestId = request.header(REQUEST_ID_HEADER);
  const requestId =
    providedRequestId && acceptedRequestIdPattern.test(providedRequestId)
      ? providedRequestId
      : randomUUID();

  request.headers[REQUEST_ID_HEADER] = requestId;
  response.setHeader('X-Request-Id', requestId);
  next();
}
