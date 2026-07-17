import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { env } from '../../config/env';

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
    const requestPath = request.originalUrl || request.url;
    const publicError = this.toPublicError(exception);

    this.logException(exception, statusCode, request, requestId);

    response
      .type('application/problem+json')
      .status(statusCode)
      .json({
        type: 'about:blank',
        title: this.getStatusTitle(statusCode),
        status: statusCode,
        detail: Array.isArray(publicError.message)
          ? publicError.message.join('; ')
          : publicError.message,
        instance: requestPath,
        requestId,
        timestamp: new Date().toISOString(),
        ...(publicError.issues === undefined ? {} : { issues: publicError.issues }),

        // Compatibility fields retained for existing v1 clients.
        ok: false,
        statusCode,
        path: requestPath,
        error: publicError,
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

  private getStatusTitle(statusCode: number): string {
    const statusName = HttpStatus[statusCode] ?? 'HTTP_ERROR';
    return String(statusName)
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private logException(
    exception: unknown,
    statusCode: number,
    request: Request,
    requestId: string,
  ): void {
    const isUnexpectedError = statusCode >= HttpStatus.INTERNAL_SERVER_ERROR;
    const shouldRedactTechnicalDetails = isUnexpectedError && env.NODE_ENV === 'production';
    const logContext = {
      event: 'http.request.failed',
      requestId,
      method: request.method,
      path: request.originalUrl || request.url,
      statusCode,
      errorName: exception instanceof Error ? exception.name : 'UnknownError',
      errorMessage: shouldRedactTechnicalDetails
        ? 'Unexpected server error'
        : exception instanceof Error
          ? exception.message
          : 'Unknown error',
    };

    if (isUnexpectedError) {
      this.logger.error(
        logContext,
        shouldRedactTechnicalDetails
          ? undefined
          : exception instanceof Error
            ? exception.stack
            : undefined,
      );
      return;
    }

    this.logger.warn(logContext);
  }
}
