import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, map } from 'rxjs';

const RAW_TEXT_TYPES = ['text/csv', 'text/plain'];

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data: unknown) => {
        // A file is the response, never its payload. Wrapping a StreamableFile
        // in `{ ok, data }` produced a JSON body served under a binary
        // Content-Type — the client downloaded a "PDF" that was actually an
        // envelope. Checked structurally rather than by adding another MIME
        // string, so any future binary route is covered without a change here.
        if (data instanceof StreamableFile) return data;
        // Read once the handler has run: a handler that picks its Content-Type
        // at run time (`@Res({ passthrough: true })` + `setHeader`) sets it
        // here, after `@Header()` values. Reading it before `next.handle()`
        // only saw the decorators and wrapped that CSV as `{ ok, data: "<csv>" }`.
        const contentType = response.getHeader('Content-Type');
        if (
          typeof contentType === 'string' &&
          RAW_TEXT_TYPES.some((type) => contentType.includes(type))
        ) {
          return data;
        }
        return { ok: true, data };
      }),
    );
  }
}
