# Ciclo de vida de credenciales de acceso

## PIN

El alta administrativa de un cliente exige un PIN de 4 a 12 dígitos. El PIN se transforma con bcrypt antes de abrir la transacción que crea usuario, perfil de cliente y credencial. La respuesta nunca devuelve el PIN ni su hash.

Un reemplazo de PIN revoca la credencial activa anterior y crea una nueva en la misma transacción. No se permite más de un PIN activo por usuario.

## Referencias externas

El backend no recibe ni almacena imagen facial, huella, minutiae, template, embedding o score biométrico. Solo registra una referencia opaca emitida por el proveedor del dispositivo junto con modalidad, proveedor, estado, consentimiento y fechas de ciclo de vida.

La referencia opaca tampoco se devuelve en respuestas.

## Endpoints

```text
POST  /api/v1/admin/access/credentials/pin
POST  /api/v1/admin/access/credentials/external-reference
GET   /api/v1/admin/access/credentials/user/:userId
PATCH /api/v1/admin/access/credentials/:id/revoke
GET   /api/v1/access/credentials/me
```

Las operaciones administrativas requieren `ADMIN` o `FRONT_DESK`. La lectura propia queda limitada al usuario autenticado.

## Reglas operativas

- Solo HTTPS en despliegue.
- No registrar bodies de estas rutas.
- Rotar el PIN ante sospecha de exposición.
- Revocar referencias externas al retirar consentimiento o cambiar proveedor.
- El adapter real debe resolver la referencia opaca y enviar solo el UUID interno de la credencial al evento canónico.
