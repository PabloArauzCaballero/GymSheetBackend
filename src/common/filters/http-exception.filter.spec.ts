import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

type CapturedResponse = {
  status: number;
  body: Record<string, unknown>;
};

function createHost(requestId = 'test-request-id-0001'): {
  host: ArgumentsHost;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = { status: 0, body: {} };
  const response = {
    type: () => response,
    status: (statusCode: number) => {
      captured.status = statusCode;
      return response;
    },
    json: (body: Record<string, unknown>) => {
      captured.body = body;
      return response;
    },
  };
  const request = {
    method: 'GET',
    url: '/api/v1/workouts/sessions',
    originalUrl: '/api/v1/workouts/sessions',
    header: () => requestId,
  };

  return {
    host: {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as unknown as ArgumentsHost,
    captured,
  };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  beforeAll(() => {
    // The filter logs through Nest's Logger; silence it so failing-path tests
    // do not pollute the reporter output.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('never exposes the message or stack of an unexpected error', () => {
    const { host, captured } = createHost();
    const leakyError = new Error('connect ECONNREFUSED 10.0.0.5:5432 as user gym_admin');

    filter.catch(leakyError, host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const serialised = JSON.stringify(captured.body);
    expect(serialised).not.toContain('ECONNREFUSED');
    expect(serialised).not.toContain('10.0.0.5');
    expect(serialised).not.toContain('gym_admin');
    expect(captured.body.detail).toBe('Error interno del servidor.');
    expect(captured.body).not.toHaveProperty('stack');
  });

  it('preserves the intended message of a deliberate HTTP exception', () => {
    const { host, captured } = createHost();

    filter.catch(new NotFoundException('Sesión de entrenamiento no encontrada.'), host);

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body.detail).toBe('Sesión de entrenamiento no encontrada.');
  });

  it('surfaces validation issues so clients can correct their request', () => {
    const { host, captured } = createHost();

    filter.catch(
      new BadRequestException({
        message: 'Datos de entrada inválidos.',
        issues: { fieldErrors: { email: ['Invalid email'] } },
      }),
      host,
    );

    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body.issues).toEqual({ fieldErrors: { email: ['Invalid email'] } });
  });

  it('does not adopt an attacker-influenced status from a non-HTTP error object', () => {
    const { host, captured } = createHost();

    // A thrown plain object carrying an out-of-range status must not be able to
    // steer the response into a success or redirect code.
    filter.catch({ status: 302, message: 'internal redirect' }, host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body.detail).toBe('Error interno del servidor.');
  });

  it('echoes the correlation identifier so a failure can be traced', () => {
    const { host, captured } = createHost('trace-abcdef123456');

    filter.catch(new NotFoundException('no encontrado'), host);

    expect(captured.body.requestId).toBe('trace-abcdef123456');
  });
});
