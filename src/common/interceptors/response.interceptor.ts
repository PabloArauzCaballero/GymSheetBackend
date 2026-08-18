import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, map } from 'rxjs';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    const contentType = response.getHeader('Content-Type');

    if (
      typeof contentType === 'string' &&
      (contentType.includes('text/csv') || contentType.includes('text/plain'))
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data: unknown) => {
        // A file is the response, never its payload. Wrapping a StreamableFile
        // in `{ ok, data }` produced a JSON body served under a binary
        // Content-Type — the client downloaded a "PDF" that was actually an
        // envelope. Checked structurally rather than by adding another MIME
        // string, so any future binary route is covered without a change here.
        if (data instanceof StreamableFile) return data;
        return { ok: true, data };
      }),
    );
  }
}
