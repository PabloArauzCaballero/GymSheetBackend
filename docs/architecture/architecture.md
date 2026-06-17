# Arquitectura del sistema GymSheet

## Decisión principal

El backend se implementa como monolito modular con NestJS, TypeScript, Sequelize y PostgreSQL.

Aunque `prompt/index.md` conserva una referencia heredada a Express, el prompt especializado `programacionBackend.md` establece que todo backend debe implementarse con NestJS. Por eso la solución usa NestJS y adapta las reglas de rutas, middlewares y controllers al modelo de módulos, controllers, services, repositories, guards, pipes y filters de NestJS.

## Módulos generados

- `AuthModule`: registro, login y JWT.
- `UsersModule`: usuario autenticado y soporte a auth.
- `ProfilesModule`: perfil antropométrico básico.
- `EquipmentModule`: catálogo de máquinas e indumentaria.
- `ExercisesModule`: ejercicios globales, personales y frecuentes.
- `WorkoutsModule`: sesiones, ejercicios de sesión y series.
- `ExportModule`: exportación JSON y CSV para entrenador externo.
- `GatewayModule`: punto de entrada interno para health y rutas.
- `DatabaseModule`: configuración Sequelize.

## Supuestos documentados

- No existe `domainModel.puml`; se usaron `classDiagram.puml`, `caseUseModel.puml`, `activityDiagramMainFlow.puml`, diagramas de estado, componentes, secuencia y despliegue.
- No existe un ER `.puml`; se generó `docs/db/schema.sql` desde las entidades del diagrama de clases y el contexto del sistema.
- El rol `ENTRENADOR_EXTERNO` está incluido porque aparece en el contexto, aunque la primera versión usa exportación sin cuenta obligatoria para entrenador externo.
- La exportación PDF no se implementa en esta fase porque el contexto permite PDF, CSV o vista compartible. Se implementan JSON y CSV.
- No se generaron workers porque el dominio actual no define colas ni procesamiento asíncrono obligatorio.

## Seguridad

- JWT Bearer token.
- Contraseñas con bcrypt.
- Rate limiter global con `@nestjs/throttler`.
- Guard global de autenticación.
- Guard de roles para endpoints administrativos.
- Validación de entrada con Zod.
- Filtro global de errores.

## Persistencia

Sequelize opera con `synchronize: false`. El esquema debe gestionarse con SQL/migraciones, no con sincronización automática en producción.
