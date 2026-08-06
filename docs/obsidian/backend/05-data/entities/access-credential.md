---
type: data
status: verified
last_reviewed: 2026-08-06
source_revision: 27f3fd2
tags: [backend, data]
---

# Entidad: access-credential

## Identidad
- **Tabla:** `access_control.credentials` · **Modelo:** `src/modules/access-control/access-credential.model.ts`
- **PK:** `id` uuid v4

## Definición de negocio
Credencial con la que un usuario abre puntos de acceso físico: PIN (hash local) o biometría
(FACE/FINGERPRINT, guardada como **referencia externa** del proveedor, con consentimiento). Genera
eventos de dispositivo que derivan en decisiones de acceso.

## Clasificación
Agregado raíz · Dominio access-control · Sensibilidad: **credencial + biométrico (categoría especial)**.
Ver [[../sensitive-data]].

## Representaciones
- ORM: `AccessCredentialModel` (`BelongsTo` user, `HasMany` deviceEvents).

## Atributos
| Campo físico | Tipo | Req | Default | Restricción |
|---|---|---|---|---|
| id | uuid | Sí | uuid_v4 | PK |
| user_id | uuid | Sí | — | FK usuarios RESTRICT |
| credential_type | varchar(30) | Sí | — | CHECK PIN/FACE/FINGERPRINT |
| provider | varchar(100) | Sí | — | — |
| pin_hash | varchar(255) | No | — | CHECK material |
| external_reference | varchar(255) | No | — | CHECK material; UK parcial |
| status | varchar(30) | Sí | ACTIVE | CHECK ACTIVE/SUSPENDED/REVOKED |
| consent_version / consent_recorded_at | varchar/timestamptz | No | — | CHECK material |
| enrolled_at | timestamptz | Sí | now() | — |
| last_verified_at / revoked_at | timestamptz | No | — | — |
| revocation_reason | text | No | — | — |
| metadata | jsonb | Sí | `{}` | — |

## Invariantes
- **CHECK `ck_credentials_material`:** PIN ⇒ `pin_hash` presente y sin `external_reference`;
  FACE/FINGERPRINT ⇒ `external_reference` + `consent_recorded_at` presentes y sin `pin_hash`.
- **UK parcial:** un PIN ACTIVO por usuario (`uq_active_pin_credential`); biometría externa única no
  revocada (`uq_external_biometric_credential`).
- No se almacenan plantillas biométricas, solo referencias opacas.

## Relaciones
- N:1 → user (RESTRICT). 1:N → access-device-event. Ver [[../relationship-catalog]] R47, R50.

## Estados
ACTIVE → SUSPENDED → REVOKED (VERIFICADO por CHECK; transición INFERIDO). Credencial no ACTIVE produce
`CREDENTIAL_INACTIVE` en la decisión de acceso.

## CRUD
- C: enrolar (con consentimiento si biometría). U: suspender/revocar (`revoked_at`, motivo). D: no
  físico (status REVOKED).

## Eventos
Enrolamiento/revocación pueden emitir eventos de dominio (INFERIDO).

## Sensibilidad
Máxima: PIN (hash) y referencia biométrica. No registrar en logs; consentimiento obligatorio y
versionado para biometría. Ver [[../sensitive-data]].

## Índices
- UK parciales PIN/biometría; `ix_credentials_user_status (user_id, status, credential_type)`.

## Riesgos
- **DATA:** `device_events.credential_id` (FK) carece de índice dedicado → borrado/consulta por
  credencial hace scan. INFERIDO — ver [[../indexing-and-query-patterns]].
- Cumplimiento: biometría es categoría especial; revisar retención y borrado en proveedor externo.

## Evidencia
Migración `202607190002` (tabla + CHECK material + UK parciales); `access-credential.model.ts`;
enums `CredentialType`, `CredentialStatus`; ADR-0002 (adapter boundary).

## Relaciones (wikilinks)
[[entities/user|user]] · [[../data-dictionary]] · [[../sensitive-data]] ·
[[03-domains/access-control/index|Dominio Access Control]]
