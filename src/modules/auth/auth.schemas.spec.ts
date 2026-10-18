import { loginSchema, registerSchema } from './auth.schemas';

/**
 * El alta y el acceso tienen que reducir la misma entrada a la misma
 * credencial: si el registro guardara el correo de una forma y el login lo
 * buscara de otra, la cuenta recién creada no podría volver a entrar.
 */
describe('auth.schemas: alta y acceso normalizan igual', () => {
  const registro = (email: string, password: string) =>
    registerSchema.parse({ email, password, nombreCompleto: 'Ana Prueba', acceptedTerms: true });

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
