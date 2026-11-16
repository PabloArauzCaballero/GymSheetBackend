import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { lastValueFrom, defer, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  function run(
    handler: (headers: Map<string, string>) => unknown,
    decoratorHeaders: Record<string, string> = {},
  ) {
    // `@Header()` values are on the response before interceptors run.
    const headers = new Map(Object.entries(decoratorHeaders));
    const response = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
    };
    const context = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => defer(() => of(handler(headers))) };
    return lastValueFrom(new ResponseInterceptor().intercept(context, next));
  }

  it('wraps a JSON payload in the success envelope', async () => {
    await expect(run(() => ({ id: 1 }))).resolves.toEqual({ ok: true, data: { id: 1 } });
  });

  it('leaves a StreamableFile untouched', async () => {
    const file = new StreamableFile(Buffer.from('%PDF'));
    await expect(run(() => file)).resolves.toBe(file);
  });

  it('passes through text set by @Header() before the handler', async () => {
    await expect(
      run(() => 'a,b\n', { 'content-type': 'text/csv; charset=utf-8' }),
    ).resolves.toBe('a,b\n');
    await expect(
      run(() => '# metrics', { 'content-type': 'text/plain; version=0.0.4' }),
    ).resolves.toBe('# metrics');
  });

  it('passes through a CSV whose Content-Type the handler sets at run time', async () => {
    const result = await run((headers) => {
      headers.set('content-type', 'text/csv; charset=utf-8');
      return 'a,b\n';
    });
    expect(result).toBe('a,b\n');
  });

  it('still wraps when the handler only sets unrelated headers', async () => {
    const result = await run((headers) => {
      headers.set('x-next-cursor', 'abc');
      return [1];
    });
    expect(result).toEqual({ ok: true, data: [1] });
  });
});
