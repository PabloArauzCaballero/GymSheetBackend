import { AccessCredentialModel } from './access-credential.model';

/** Never exposes hashes or opaque provider references. */
export function mapAccessCredential(credential: AccessCredentialModel) {
  return {
    id: credential.id,
    usuarioId: credential.userId,
    tipo: credential.credentialType,
    proveedor: credential.provider,
    estado: credential.status,
    referenciaExternaRegistrada: credential.externalReference !== null,
    versionConsentimiento: credential.consentVersion,
    consentimientoRegistradoEn: credential.consentRecordedAt,
    registradoEn: credential.enrolledAt,
    verificadoPorUltimaVezEn: credential.lastVerifiedAt,
    revocadoEn: credential.revokedAt,
  };
}
