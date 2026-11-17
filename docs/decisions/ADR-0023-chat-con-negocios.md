# ADR-0023 — Chat de personas con negocios (franja 8f)

Estado: **aceptado**
Fecha: 2026-11-17
Continúa [ADR-0020](./ADR-0020-cuentas-de-negocio-y-tipo-de-cuenta.md) (cuenta de negocio y
`AccountKindGuard`) y [ADR-0021](./ADR-0021-kyc-de-negocios-y-aprobacion-automatica.md) (una ficha
es pública solo por el KYC). Reutiliza el chat existente: participantes, medios cifrados, push solo
sin socket ([ADR-0016](./ADR-0016-push-de-chat-y-presencia.md)), confirmaciones de lectura y
denuncias a la moderación central de REPP ([ADR-0018](./ADR-0018-moderacion-central-de-repp.md)).

## Contexto

Una persona tiene que poder preguntarle a un negocio por un plan, un producto o un pedido sin ser
«conexión» suya. El negocio solo responde: si pudiera escribir en frío, cualquier ficha aprobada en
segundos tendría un canal de spam hacia todas las personas. Lo que se dice en ese chat es la
constancia de una disputa por un pago (REPP no toca el dinero), así que nada puede borrarse solo.

## Decisión

1. **Modelo** (migración reversible `202611200701-business-conversations`):
   `chat.conversations.kind` `DIRECT|SYSTEM|BUSINESS` (por defecto `DIRECT`; las filas con
   `system_kind` pasan a `SYSTEM`, que sigue diciendo cuál), `business_entity_id` y
   `person_user_id`. CHECKs: las dos columnas existen si y solo si `kind = 'BUSINESS'`, un `SYSTEM`
   tiene `system_kind`, y un `BUSINESS` nunca tiene `disappearing_seconds`. Índice único parcial
   `(business_entity_id, person_user_id) WHERE kind = 'BUSINESS' AND revoked_at IS NULL`: una
   conversación viva por par. `chat.business_blocks` registra los bloqueos (PK por par).
   Rollback: revoca las conversaciones `BUSINESS` (sin borrar mensajes) para que el código anterior
   no las liste como chats 1:1, y quita tabla, índices, CHECKs y columnas.
2. **Abrir.** `POST /me/business-conversations {entityId}`: solo personas (un negocio recibe
   `403 ACCOUNT_KIND_NOT_ALLOWED` del guard), correo verificado, sin conexión social. La ficha debe
   estar `ACTIVE` y su cuenta de negocio `ACTIVE` con el login activo; cualquier otro caso
   (borrador, pausada, suspendida, cerrada, inexistente) responde el mismo `404`, así no se puede
   sondear el estado de una ficha. `201` si se abrió ahora, `200` si ya había una viva. El
   participante del lado del negocio es su cuenta (un login por negocio, ADR-0020); ambos pueden
   escribir. Se serializa por persona con `pg_advisory_xact_lock` (no un lock de fila: no se cruza
   con los locks de `usuarios` de las confirmaciones de lectura); el índice único sigue siendo el
   invariante, y si otra apertura ganó, la perdedora devuelve la conversación ganadora.
3. **Límite.** 10 conversaciones nuevas con negocios por persona en 24 h móviles, contando también
   las revocadas (si no, abrir y cerrar esquivaría el límite) → `429 BUSINESS_CHAT_LIMIT`. Recuperar
   una existente no cuenta. Se evalúa después de comprobar la ficha, así el `429` no distingue fichas
   no públicas.
4. **El negocio solo responde.** `AccountKindGuard` pasa a ser por método y ruta: el negocio alcanza
   `me/conversations/*` salvo `POST me/conversations` (abrir un chat) y `pending-replies` (matches
   sociales); el ticket de socket sigue cerrado, el negocio usa REST y push. El inventario de rutas
   (`account-kind.route-inventory.spec.ts`) fija la lista exacta.
5. **Constancia.** En un `BUSINESS` no hay mensajes temporales (`422 BUSINESS_CHAT_NO_DISAPPEARING`,
   además del CHECK) ni ubicación, enviada o reenviada (`422 BUSINESS_CHAT_NO_LOCATION`). Ambas
   reglas se comprueban bajo el lock de la conversación, en el único punto que escribe mensajes.
6. **Negocio suspendido.** Una cuenta de negocio que no está `ACTIVE` (suspendida por REPP o
   cerrada) no envía en sus conversaciones (`409 BUSINESS_ACCOUNT_LOCKED`, antes de subir un
   archivo); sus clientes sí pueden escribirle (reclamos). Sin esto, un negocio suspendido por
   fraude seguía pidiendo pagos por chat.
7. **Lo que ve cada lado.** El negocio ve de la persona solo el nombre visible y la primera foto de
   perfil; nunca el perfil social (sus rutas siguen en `403`), y en la lista `otherUserOnline` es
   `false` y `otherUserLastSeenAt` `null`. La persona ve el nombre y el logo de la ficha. Los
   ítems de `/me/conversations` ganan `kind` y `businessEntityId`. Los mensajes solo llevan
   `senderId`.
8. **Bloqueo.** `POST /business/me/conversations/:id/block` (`@Roles(NEGOCIO)`): solo sobre una
   conversación `BUSINESS` de su propia ficha (si no, `404`); registra el bloqueo y revoca la
   conversación. Idempotente. La persona ya no puede abrirla: **`403 BUSINESS_CHAT_BLOCKED`**, no
   `404`, porque la ficha sigue pública y un `404` le diría que no existe; con el código, la app
   explica que ese negocio no recibe sus mensajes y la persona puede acudir a REPP si hay un pedido
   en disputa. El bloqueo es de ese negocio: los demás siguen recibiendo sus mensajes. Desbloquear
   no existe todavía.
9. **Denuncias.** `CHAT_MESSAGE` funciona igual que en cualquier chat: copia de evidencia en la
   misma transacción y cola de REPP (los avisos nombran al «equipo de moderación de REPP»). La
   cuenta de negocio no es de ningún gimnasio, así que la denuncia de un mensaje deja de exigir el
   mismo gimnasio: ser participante (`canReporterViewChatMessage`) es la prueba de acceso. Como en
   todo 1:1, denunciar aparta a la persona: la conversación se revoca y la persona puede abrir otra
   (cuenta para el límite).
10. **Cierre de la persona.** `chat.business_blocks` entra en el catálogo de cierre (se borran los
    bloqueos que la nombran, como `social.user_blocks`). El cierre y la exportación del negocio
    quedan fuera de esta decisión.

## Consecuencias

- Toda consulta que buscaba «el chat 1:1 de estas dos personas» filtra `kind`: `findDirectConversation`
  excluye `BUSINESS`; la creación del chat de entrenar juntos y las respuestas pendientes exigen
  `DIRECT`.
- Las revocaciones sociales existentes (bloqueo social, retiro de conexión, denuncia) siguen
  alcanzando una conversación `BUSINESS` entre los mismos dos usuarios. Un negocio no tiene
  conexiones; el bloqueo social que hace la persona y su denuncia sí la revocan, y la persona puede
  volver a abrirla (es decisión suya, no del negocio).
- Pruebas: `business-chat.service.spec.ts`, `account-kind.guard.spec.ts`,
  `account-kind.route-inventory.spec.ts`, `moderation.service.spec.ts` y
  `test/business-chat.e2e-spec.ts`.
