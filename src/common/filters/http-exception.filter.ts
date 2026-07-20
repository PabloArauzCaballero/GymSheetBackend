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

type ErrorWithHttpStatus = {
  status?: unknown;
  statusCode?: unknown;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const response = httpContext.getResponse<Response>();
    const request = httpContext.getRequest<Request>();
    const statusCode = this.resolveStatusCode(exception);
    const requestId = request.header('x-request-id') ?? 'unknown';
    const requestPath = request.originalUrl || request.url;
    const publicError = this.toPublicError(exception, statusCode);

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

  private resolveStatusCode(exception: unknown): HttpStatus {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    if (typeof exception !== 'object' || exception === null) {
      return HttpStatus.INTERNAL_SERVER_ERROR;
    }

    const possibleStatus = exception as ErrorWithHttpStatus;
    const statusCandidates = [possibleStatus.statusCode, possibleStatus.status];
    const validStatus = statusCandidates.find(
      (candidate): candidate is HttpStatus =>
        typeof candidate === 'number' &&
        Number.isInteger(candidate) &&
        candidate >= 400 &&
        candidate <= 599,
    );

    return validStatus ?? HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private toPublicError(exception: unknown, statusCode: HttpStatus): PublicErrorPayload {
    if (statusCode === HttpStatus.PAYLOAD_TOO_LARGE) {
      return { message: 'El cuerpo de la solicitud supera el límite permitido.' };
    }

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
    statusCode: HttpStatus,
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
