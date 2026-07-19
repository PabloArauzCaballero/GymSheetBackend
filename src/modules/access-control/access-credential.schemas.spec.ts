import { CredentialType } from '../../common/enums/domain.enums';
import {
  createExternalCredentialSchema,
  createPinCredentialSchema,
} from './access-credential.schemas';

describe('access credential schemas', () => {
  it('accepts a bounded numeric access PIN', () => {
    const result = createPinCredentialSchema.parse({
      usuarioId: '550e8400-e29b-41d4-a716-446655440000',
      pin: '482917',
      proveedor: 'INTERNAL_PIN',
    });
    expect(result).toMatchObject({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      pin: '482917',
    });
  });

  it('stores only an opaque provider reference for an external modality', () => {
    const result = createExternalCredentialSchema.parse({
      usuarioId: '550e8400-e29b-41d4-a716-446655440000',
      modalidad: CredentialType.FACE,
      proveedor: 'TURNSTILE_VENDOR',
      referenciaExterna: 'opaque-reference-001',
      versionConsentimiento: '2026-01',
      consentimientoRegistradoEn: '2026-07-19T12:00:00-04:00',
      metadata: {},
    });
    expect(result.externalReference).toBe('opaque-reference-001');
  });

  it('rejects undeclared provider payload fields', () => {
    const result = createExternalCredentialSchema.safeParse({
      usuarioId: '550e8400-e29b-41d4-a716-446655440000',
      modalidad: CredentialType.FINGERPRINT,
      proveedor: 'TURNSTILE_VENDOR',
      referenciaExterna: 'opaque-reference-001',
      versionConsentimiento: '2026-01',
      consentimientoRegistradoEn: '2026-07-19T12:00:00-04:00',
      template: 'not-accepted',
      metadata: {},
    });
    expect(result.success).toBe(false);
  });
});
