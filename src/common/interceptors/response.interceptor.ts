import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable, map } from 'rxjs';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    const contentType = response.getHeader('Content-Type');

    if (typeof contentType === 'string' && contentType.includes('text/csv')) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        ok: true,
        data,
      })),
    );
  }
}
