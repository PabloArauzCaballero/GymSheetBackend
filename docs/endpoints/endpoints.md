# Endpoints GymSheet

Todos los endpoints usan el prefijo configurable `API_PREFIX`; el valor por defecto es `/api/v1`.

Salvo los endpoints marcados como públicos, se requiere:

```http
Authorization: Bearer <access-token>
```

Las respuestas JSON exitosas usan el envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Los errores usan `application/problem+json`, incluyen `requestId` y no exponen stack traces en producción.

## Reglas generales

- Los identificadores de ruta deben ser UUID válidos.
- `page` comienza en 1.
- `pageSize` está limitado a 100.
- Los bodies están limitados por `REQUEST_BODY_LIMIT`.
- Las rutas administrativas requieren el rol `ADMIN` revalidado contra PostgreSQL.
- Las mutaciones de ejercicios personales, media, sesiones y series verifican ownership.
- Los campos externos en español se conservan por compatibilidad de la API v1; el código interno usa nombres en inglés.

## Públicos

| Método | Ruta | Uso | Controles |
|---|---|---|---|
| POST | `/auth/register` | Registrar cliente | validación de email/password y límite de autenticación |
| POST | `/auth/login` | Iniciar sesión | mensaje uniforme de credenciales y límite de autenticación |
| GET | `/gateway/health` | Liveness HTTP | no incluye secretos ni inventario interno |
| GET | `/gateway/routes` | Capacidades públicas resumidas | no devuelve rutas administrativas completas |

## Identidad y perfil

| Método | Ruta | Uso |
|---|---|---|
| GET | `/auth/me` | Principal revalidado generado por la estrategia JWT |
| GET | `/users/me` | Datos persistidos y mapeados del usuario activo |
| GET | `/profile` | Consultar perfil antropométrico propio |
| POST | `/profile` | Crear o reemplazar el perfil propio |
| PATCH | `/profile` | Actualizar el perfil propio |

El JWT exige firma, expiración, issuer, audience y algoritmo esperados. Cada petición autenticada confirma que el usuario siga activo y obtiene su rol actual.

## Equipamiento

| Método | Ruta | Rol | Uso |
|---|---|---|---|
| GET | `/equipment` | autenticado | Listar equipo disponible |
| POST | `/admin/equipment` | ADMIN | Crear equipo |
| PATCH | `/admin/equipment/:id` | ADMIN | Editar equipo |
| DELETE | `/admin/equipment/:id` | ADMIN | Inhabilitar equipo; no borra historial |

Los ejercicios solo pueden asociarse a equipos existentes y enlazables. La lista enviada se deduplica antes de persistir.

## Ejercicios

| Método | Ruta | Rol | Uso |
|---|---|---|---|
| GET | `/exercises` | autenticado | Listar ejercicios globales y personales propios |
| GET | `/exercises/:id` | autenticado | Ver ejercicio visible |
| POST | `/exercises/personal` | autenticado | Crear ejercicio personal |
| PATCH | `/exercises/:id` | propietario | Editar ejercicio personal propio |
| DELETE | `/exercises/:id` | propietario | Inhabilitar ejercicio personal propio |
| POST | `/admin/exercises/global` | ADMIN | Crear ejercicio global |
| PATCH | `/admin/exercises/global/:id` | ADMIN | Editar ejercicio global |
| DELETE | `/admin/exercises/global/:id` | ADMIN | Inhabilitar ejercicio global |

### Filtros de `GET /exercises`

| Parámetro | Tipo | Restricción |
|---|---|---|
| `page` | integer | mínimo 1; default 1 |
| `pageSize` | integer | 1–100; default 25 |
| `search` | string | 1–120 caracteres |
| `grupoMuscular` | string | máximo 100 |
| `equipoId` | UUID | equipo asociado |
| `bodyPart` | string | máximo 100 |
| `targetMuscle` | string | máximo 120 |
| `dataSource` | enum | `CUSTOM` o `EXERCISES_DATASET` |

La respuesta incluye `items`, `page`, `pageSize`, `total` y `totalPages` dentro de `data`.

### Campos extendidos

Un ejercicio puede incluir:

- `bodyPart`, `targetMuscle` y `synergistMuscleGroup`;
- `secondaryMuscles`, máximo 30;
- `instructions` e `instructionSteps` por idioma;
- `metadata`, limitado a 16 KiB;
- `equipoIds`, máximo 30.

## Multimedia de ejercicios

| Método | Ruta | Permiso | Uso |
|---|---|---|---|
| GET | `/exercises/:exerciseId/media` | ejercicio visible | Listar media activa |
| POST | `/exercises/:exerciseId/media` | propietario o ADMIN para global | Registrar referencia multimedia |
| DELETE | `/exercise-media/:mediaId` | propietario o ADMIN para global | Inhabilitar media y promover reemplazo primario |

Controles relevantes:

- máximo 10 elementos activos por ejercicio;
- URL HTTPS y máximo 2048 caracteres;
- `altText` obligatorio;
- atribución, licencia, checksum SHA-256 y proveedor explícitos;
- solo un elemento primario lógico por ejercicio;
- la eliminación es lógica para preservar trazabilidad.

Registrar una URL no implica que el backend tenga derecho a copiar o redistribuir el archivo. La importación de media externa permanece deshabilitada salvo confirmación explícita de licencia.

## Ejercicios frecuentes

| Método | Ruta | Uso |
|---|---|---|
| GET | `/user-exercises` | Listar ejercicios frecuentes del usuario |
| POST | `/user-exercises/:exerciseId` | Agregar frecuente de forma única |
| DELETE | `/user-exercises/:exerciseId` | Quitar frecuente |

## Sesiones de entrenamiento

| Método | Ruta | Uso |
|---|---|---|
| POST | `/workouts` | Iniciar una sesión; una sola sesión abierta por usuario |
| GET | `/workouts` | Historial paginado (`page`, `pageSize`) |
| GET | `/workouts/:id` | Detalle de sesión propia |
| PATCH | `/workouts/:id/finish` | Finalizar una sesión en progreso |
| PATCH | `/workouts/:id/cancel` | Cancelar una sesión en progreso |
| POST | `/workouts/:sessionId/exercises` | Agregar ejercicio visible a sesión propia |
| PATCH | `/workouts/session-exercises/:id` | Editar ejercicio de sesión en progreso |
| DELETE | `/workouts/session-exercises/:id` | Eliminar ejercicio de sesión en progreso |
| POST | `/workouts/session-exercises/:id/sets` | Registrar serie con número único |
| PATCH | `/workouts/sets/:id` | Editar serie propia |
| DELETE | `/workouts/sets/:id` | Eliminar serie propia |

Transiciones permitidas:

```txt
EN_PROGRESO -> FINALIZADA
EN_PROGRESO -> CANCELADA
```

Una sesión finalizada o cancelada no admite nuevas mutaciones.

## Exportaciones

| Método | Ruta | Respuesta | Uso |
|---|---|---|---|
| GET | `/export/workout-history` | JSON envelope | Exportación acotada del historial propio |
| GET | `/export/workout-history/csv` | `text/csv` | CSV descargable con neutralización de fórmulas |

Las exportaciones leen el historial por páginas para acotar memoria. El CSV escapa separadores, comillas y celdas que podrían ejecutarse como fórmulas en una hoja de cálculo.

## Importación administrativa de dataset

| Método | Ruta | Rol | Uso |
|---|---|---|---|
| POST | `/admin/exercises/import/exercises-dataset` | ADMIN | Importar o actualizar ejercicios externos de forma idempotente |

El conector está deshabilitado por defecto. Al habilitarlo aplica:

- HTTPS obligatorio;
- allowlist de hosts;
- timeout;
- límite máximo de bytes;
- validación Zod de la respuesta;
- lotes configurables;
- identidad externa estable para upsert;
- media externa deshabilitada por defecto;
- confirmación separada de licencia para importar media.

Una ejecución repetida no debe duplicar ejercicios con la misma identidad de origen.

## Errores

Ejemplo conceptual:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "El identificador debe ser un UUID válido.",
  "instance": "/api/v1/exercises/not-a-uuid",
  "requestId": "5c454f50-1b97-4b94-9ce7-5c85bff02a20"
}
```

Códigos principales:

- `400`: validación o formato incorrecto;
- `401`: token ausente, inválido, expirado o usuario inactivo;
- `403`: rol, ownership o transición no permitidos;
- `404`: recurso no visible o inexistente;
- `409`: unicidad, estado o conflicto de negocio;
- `413`: body demasiado grande;
- `429`: rate limit;
- `500`: error inesperado sin detalle sensible.

## Contrato fuente

La especificación OpenAPI se mantiene en `docs/endpoints/openapi.yaml`. Cualquier cambio de controller, schema, ruta, error o límite debe actualizar este documento, OpenAPI y Postman en el mismo PR.
