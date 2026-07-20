import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, finalize, tap } from 'rxjs';
import { HttpMetricsService } from './http-metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: HttpMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = process.hrtime.bigint();
    let recorded = false;

    const record = (statusCode: number): void => {
      if (recorded) return;
      recorded = true;
      const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
      const durationMilliseconds = Number(elapsedNanoseconds) / 1_000_000;
      this.metricsService.recordHttpRequest(
        request.method,
        this.resolveRouteTemplate(request),
        statusCode,
        durationMilliseconds,
      );
    };

    return next.handle().pipe(
      tap({
        error: (error: unknown) => {
          record(error instanceof HttpException ? error.getStatus() : 500);
        },
      }),
      finalize(() => record(response.statusCode)),
    );
  }

  private resolveRouteTemplate(request: Request): string {
    const routePath = (request.route as { path?: unknown } | undefined)?.path;

    if (typeof routePath === 'string') {
      return `${request.baseUrl}${routePath}` || '/';
    }

    return 'unmatched';
  }
}
