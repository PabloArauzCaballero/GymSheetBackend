# Endpoints GymSheet

Todos los endpoints están bajo el prefijo configurable `API_PREFIX`, por defecto:

```txt
/api/v1
```

## Públicos

| Método | Ruta | Uso |
|---|---|---|
| POST | `/auth/register` | Registrar cliente |
| POST | `/auth/login` | Iniciar sesión |
| GET | `/gateway/health` | Health check |
| GET | `/gateway/routes` | Módulos principales |

## Autenticados

| Método | Ruta | Uso |
|---|---|---|
| GET | `/auth/me` | Usuario desde JWT |
| GET | `/users/me` | Datos persistidos del usuario |
| GET | `/profile` | Consultar perfil |
| POST | `/profile` | Crear perfil |
| PATCH | `/profile` | Actualizar perfil |
| GET | `/equipment` | Ver catálogo disponible |
| GET | `/exercises` | Listar ejercicios visibles |
| GET | `/exercises/:id` | Ver ejercicio visible |
| POST | `/exercises/personal` | Crear ejercicio personal |
| PATCH | `/exercises/:id` | Editar ejercicio personal propio |
| DELETE | `/exercises/:id` | Inhabilitar ejercicio personal propio |
| GET | `/user-exercises` | Listar frecuentes |
| POST | `/user-exercises/:exerciseId` | Agregar frecuente |
| DELETE | `/user-exercises/:exerciseId` | Quitar frecuente |
| POST | `/workouts` | Iniciar entrenamiento |
| GET | `/workouts` | Historial |
| GET | `/workouts/:id` | Detalle de sesión |
| PATCH | `/workouts/:id/finish` | Finalizar sesión |
| PATCH | `/workouts/:id/cancel` | Cancelar sesión |
| POST | `/workouts/:sessionId/exercises` | Agregar ejercicio a sesión |
| PATCH | `/workouts/session-exercises/:id` | Editar ejercicio de sesión |
| DELETE | `/workouts/session-exercises/:id` | Eliminar ejercicio de sesión |
| POST | `/workouts/session-exercises/:id/sets` | Registrar serie |
| PATCH | `/workouts/sets/:id` | Editar serie |
| DELETE | `/workouts/sets/:id` | Eliminar serie |
| GET | `/export/workout-history` | Exportar historial JSON |
| GET | `/export/workout-history/csv` | Exportar historial CSV |

## Administrador

| Método | Ruta | Uso |
|---|---|---|
| POST | `/admin/equipment` | Crear equipo |
| PATCH | `/admin/equipment/:id` | Editar equipo |
| DELETE | `/admin/equipment/:id` | Inhabilitar equipo |
| POST | `/admin/exercises/global` | Crear ejercicio global |
| PATCH | `/admin/exercises/global/:id` | Editar ejercicio global |
| DELETE | `/admin/exercises/global/:id` | Inhabilitar ejercicio global |
