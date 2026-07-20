import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const metadata = { type: 'body' } as ArgumentMetadata;

const schema = z.object({
  email: z.string().email(),
  age: z.coerce.number().int().min(0),
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value with schema coercions applied', () => {
    expect(pipe.transform({ email: 'user@example.test', age: '30' }, metadata)).toEqual({
      email: 'user@example.test',
      age: 30,
    });
  });

  it('rejects invalid input with a client-safe message', () => {
    expect(() => pipe.transform({ email: 'not-an-email', age: -1 }, metadata)).toThrow(
      BadRequestException,
    );
  });

  it('strips properties the schema does not declare', () => {
    // Guards against mass assignment: an unexpected field such as a role or an
    // identifier must not survive validation into the service layer.
    const result = pipe.transform(
      { email: 'user@example.test', age: 30, rol: 'ADMIN', id: 'attacker-chosen' },
      metadata,
    ) as Record<string, unknown>;

    expect(result).not.toHaveProperty('rol');
    expect(result).not.toHaveProperty('id');
    expect(Object.keys(result).sort()).toEqual(['age', 'email']);
  });

  it.each([
    ['null', null],
    ['a primitive', 'a string body'],
    ['an array', []],
  ])('rejects %s rather than passing it through', (_label, hostileValue) => {
    expect(() => pipe.transform(hostileValue, metadata)).toThrow(BadRequestException);
  });

  it('reports which fields failed so the client can correct them', () => {
    try {
      pipe.transform({ email: 'not-an-email', age: 30 }, metadata);
      throw new Error('expected the pipe to reject the payload');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        message: string;
        issues: { fieldErrors: Record<string, string[]> };
      };
      expect(response.message).toBe('Datos de entrada inválidos.');
      expect(response.issues.fieldErrors).toHaveProperty('email');
    }
  });
});
