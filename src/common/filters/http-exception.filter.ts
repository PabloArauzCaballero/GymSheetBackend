import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

type PublicErrorPayload = {
  message: string | string[];
  issues?: unknown;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const response = httpContext.getResponse<Response>();
    const request = httpContext.getRequest<Request>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = request.header('x-request-id') ?? 'unknown';

    this.logException(exception, statusCode, request, requestId);

    response.status(statusCode).json({
      ok: false,
      statusCode,
      path: request.originalUrl || request.url,
      timestamp: new Date().toISOString(),
      requestId,
      error: this.toPublicError(exception),
    });
  }

  private toPublicError(exception: unknown): PublicErrorPayload {
    if (!(exception instanceof HttpException)) {
      return { message: 'Error interno del servidor.' };
    }

    const exceptionResponse = exception.getResponse();

    if (typeof exceptionResponse === 'string') {
      return { message: exceptionResponse };
    }

    if (typeof exceptionResponse !== 'object' || exceptionResponse === null) {
      return { message: exception.message };
    }

    const responseRecord = exceptionResponse as Record<string, unknown>;
    const message = this.readPublicMessage(responseRecord.message, exception.message);
    const issues = responseRecord.issues;

    return issues === undefined ? { message } : { message, issues };
  }

  private readPublicMessage(value: unknown, fallbackMessage: string): string | string[] {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      return value;
    }

    return fallbackMessage;
  }

  private logException(
    exception: unknown,
    statusCode: number,
    request: Request,
    requestId: string,
  ): void {
    const logContext = {
      event: 'http.request.failed',
      requestId,
      method: request.method,
      path: request.originalUrl || request.url,
      statusCode,
      errorName: exception instanceof Error ? exception.name : 'UnknownError',
      errorMessage: exception instanceof Error ? exception.message : 'Unknown error',
    };

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(logContext, exception instanceof Error ? exception.stack : undefined);
      return;
    }

    this.logger.warn(logContext);
  }
}
