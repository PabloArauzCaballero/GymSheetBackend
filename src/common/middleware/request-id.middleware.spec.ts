import { Request, Response } from 'express';
import { requestIdMiddleware } from './request-id.middleware';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function runMiddleware(providedRequestId: string | undefined): {
  forwardedRequestId: string;
  responseHeader: string;
} {
  const headers: Record<string, string | undefined> = {
    'x-request-id': providedRequestId,
  };
  const request = {
    headers,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  let responseHeader = '';
  const response = {
    setHeader: (_name: string, value: string) => {
      responseHeader = value;
    },
  } as unknown as Response;

  requestIdMiddleware(request, response, () => undefined);

  return { forwardedRequestId: headers['x-request-id'] as string, responseHeader };
}

describe('requestIdMiddleware', () => {
  it('accepts a well-formed caller-supplied correlation identifier', () => {
    const { forwardedRequestId, responseHeader } = runMiddleware('client-trace-0001');

    expect(forwardedRequestId).toBe('client-trace-0001');
    expect(responseHeader).toBe('client-trace-0001');
  });

  it('generates an identifier when the caller supplies none', () => {
    const { forwardedRequestId, responseHeader } = runMiddleware(undefined);

    expect(forwardedRequestId).toMatch(UUID_PATTERN);
    expect(responseHeader).toBe(forwardedRequestId);
  });

  it.each([
    ['CRLF response-splitting payload', 'abcdefgh\r\nSet-Cookie: session=stolen'],
    ['HTML/script payload', '<script>alert(1)</script>'],
    ['log-forging newlines', 'abcdefgh\n[ERROR] forged log line'],
    ['too short to be meaningful', 'short'],
    ['excessively long', 'a'.repeat(129)],
  ])('replaces a rejected identifier (%s) with a generated UUID', (_label, hostileValue) => {
    // The value is reflected into both the response header and the error body,
    // so anything outside the accepted alphabet must never be forwarded.
    const { forwardedRequestId, responseHeader } = runMiddleware(hostileValue);

    expect(forwardedRequestId).toMatch(UUID_PATTERN);
    expect(forwardedRequestId).not.toBe(hostileValue);
    expect(responseHeader).toMatch(UUID_PATTERN);
  });

  it('overwrites the raw inbound header so later readers cannot see the hostile value', () => {
    // Downstream code reads `request.headers['x-request-id']` directly; the
    // sanitised value must replace the original in place.
    const { forwardedRequestId } = runMiddleware('bad\r\nvalue');

    expect(forwardedRequestId).not.toContain('\r');
    expect(forwardedRequestId).not.toContain('\n');
  });
});
