# Evidencia de capacidades — API en vivo (Playwright)

Screenshots generados con **Playwright** (Chrome real, `playwright-core`) ejecutando
llamadas HTTP autenticadas reales contra el stack Docker en marcha. Cada tarjeta muestra
rol → método → ruta → código de estado → JSON de respuesta real.

- [`evidence-full.png`](./evidence-full.png) — reporte completo (los 3 roles).
- [`evidence-cliente.png`](./evidence-cliente.png) — capacidades de CLIENTE.
- [`evidence-instructor.png`](./evidence-instructor.png) — flujo INSTRUCTOR → entrenado.
- [`evidence-administrador.png`](./evidence-administrador.png) — capacidades de ADMIN.
- [`evidence.html`](./evidence.html) — el reporte navegable.
- [`evidence-summary.txt`](./evidence-summary.txt) — 21 llamadas, todas 2xx.

Regenerar: con el stack `docker compose up -d`, ejecutar el generador de Playwright
(`scratchpad/evidence/gen.js`). Todas las llamadas usan cuentas sembradas reales.

## Matriz de capacidades (verificada en la evidencia)

| Rol | Capacidad | Estado | Endpoint(s) |
|---|---|---|---|
| Cliente | Ratear ejercicio (favorito + estrellas) | ✅ 200 | `PUT /me/exercises/:id/preference` |
| Cliente | Recomendaciones de ejercicios similares | ✅ 200 | `GET /exercises/:id/similar` |
| Cliente | Etiquetas de grupo muscular + músculo | ✅ 200 | `GET /exercises/:id/muscles` |
| Cliente | Buscar ejercicios por grupo muscular | ✅ 200 | `GET /muscle-groups/:code/exercises` |
| Cliente | Buscar ejercicios por músculo específico | ✅ 200 | `GET /muscles/:code/exercises` |
| Cliente | Crear ejercicios personalizados | ✅ 201 | `POST /exercises/personal` |
| Instructor | Crear rutina, agregar ejercicios | ✅ 201 | `POST /routines`, `POST /routines/:id/exercises` |
| Instructor | Asignar al entrenado (y que le aparezca) | ✅ 201/200 | `POST /routines/:id/assign`, `GET /routines/assignments/me` |
| Admin | Sucursales CRUD (alta/baja) | ✅ 201/200 | `POST\|DELETE /admin/facilities/branches` |
| Admin | Maquinaria/equipamiento CRUD | ✅ 200 | `/equipment`, `/admin/equipment` |
| Admin | Catálogo de servicios CRUD | ✅ 201/200 | `/admin/membership/features`, `/plans` |
| Admin | Publicidad in-app (broadcast) | ✅ 201 | `POST /admin/notifications/broadcast` |

Todo lo anterior está respaldado por: `type-check` ✅, `lint` ✅, `yarn test` (42 suites / 184
tests) ✅, y esta evidencia de ejecución real.
