import { LEGAL_DOCUMENTS } from '../legal/legal-documents';
import { loginSchema, registerSchema } from './auth.schemas';

const signupFields = {
  genero: 'FEMALE',
  fechaNacimiento: '1995-05-15',
  termsVersion: LEGAL_DOCUMENTS.TERMS,
  acceptedTerms: true,
};

/**
 * El alta y el acceso tienen que reducir la misma entrada a la misma
 * credencial: si el registro guardara el correo de una forma y el login lo
 * buscara de otra, la cuenta recién creada no podría volver a entrar.
 */
describe('auth.schemas: alta y acceso normalizan igual', () => {
  const registro = (email: string, password: string) =>
    registerSchema.parse({ email, password, nombreCompleto: 'Ana Prueba', ...signupFields });

  it.each([
    ['ana@repp.test'],
    ['Ana@Repp.Test'],
    ['  ana@repp.test  '],
    ['\tANA@REPP.TEST\n'],
  ])('el correo %j queda igual en registro y login', (email) => {
    const alta = registro(email, 'clave-segura-1');
    const acceso = loginSchema.parse({ email, password: 'clave-segura-1' });
    expect(alta.email).toBe('ana@repp.test');
    expect(acceso.email).toBe(alta.email);
  });

  it('la contraseña se conserva byte a byte: ni trim ni minúsculas', () => {
    const password = '  Clave Con Espacios  ';
    expect(registro('ana@repp.test', password).password).toBe(password);
    expect(loginSchema.parse({ email: 'ana@repp.test', password }).password).toBe(password);
  });
});

describe('auth.schemas: registerSchema exige sexo, mayoría de edad y versión de términos', () => {
  const valid = { email: 'ana@repp.test', password: 'clave-segura-1', nombreCompleto: 'Ana Prueba', ...signupFields };
  const fieldErrors = (input: Record<string, unknown>) => {
    const result = registerSchema.safeParse(input);
    expect(result.success).toBe(false);
    return result.success ? {} : result.error.flatten().fieldErrors;
  };

  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-16T12:00:00.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('maps the signup fields to the internal shape', () => {
    expect(registerSchema.parse(valid)).toMatchObject({
      gender: 'FEMALE',
      birthDate: '1995-05-15',
      termsVersion: LEGAL_DOCUMENTS.TERMS,
    });
  });

  it('rejects a missing birth date', () => {
    const { fechaNacimiento: _omitted, ...input } = valid;
    expect(fieldErrors(input).fechaNacimiento).toEqual(['Indica tu fecha de nacimiento.']);
  });

  it('rejects someone aged 17 years and 364 days and accepts exactly 18', () => {
    expect(fieldErrors({ ...valid, fechaNacimiento: '2008-11-17' }).fechaNacimiento).toEqual([
      'Debes tener al menos 18 años.',
    ]);
    expect(registerSchema.safeParse({ ...valid, fechaNacimiento: '2008-11-16' }).success).toBe(true);
  });

  it('rejects impossible dates and ages over 100', () => {
    expect(fieldErrors({ ...valid, fechaNacimiento: '1990-02-31' })).toHaveProperty('fechaNacimiento');
    expect(fieldErrors({ ...valid, fechaNacimiento: '1925-01-01' })).toHaveProperty('fechaNacimiento');
  });

  it('rejects a missing or non-binary sex with the same message', () => {
    const { genero: _omitted, ...input } = valid;
    expect(fieldErrors(input).genero).toEqual(['Elige tu sexo.']);
    expect(fieldErrors({ ...valid, genero: 'UNSPECIFIED' }).genero).toEqual(['Elige tu sexo.']);
  });

  it('requires the terms version (its value is checked by the service, not the schema)', () => {
    const { termsVersion: _omitted, ...input } = valid;
    expect(fieldErrors(input)).toHaveProperty('termsVersion');
    expect(registerSchema.safeParse({ ...valid, termsVersion: '2000-01-01' }).success).toBe(true);
  });
});
