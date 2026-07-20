# Arquitectura del sistema GymSheet

## Decisión principal

El backend es un monolito modular con NestJS, TypeScript, Sequelize y PostgreSQL. Los procesos asíncronos se despliegan como workers persistentes separados del API y reutilizan módulos de aplicación mediante contextos Nest sin servidor HTTP.

## Módulos existentes

- `AuthModule`: registro, login y JWT.
- `UsersModule`: identidad autenticada.
- `ProfilesModule`: perfil antropométrico.
- `EquipmentModule`: catálogo de máquinas e indumentaria.
- `ExercisesModule`: ejercicios y multimedia.
- `WorkoutsModule`: sesiones y series.
- `ExportModule`: exportación JSON/CSV.
- `GatewayModule`: información operativa controlada.
- `HealthModule`: liveness, readiness y métricas.
- `DatabaseModule`: Sequelize y PostgreSQL.

## Expansión empresarial

El nuevo alcance añade cinco límites de dominio:

```text
facilities
→ sedes, salas, puntos de acceso y asignación de máquinas

membership
→ planes, membresías, clientes y personal

access_control
→ credenciales, eventos de dispositivo y decisiones

notifications
→ mensajes in-app, preferencias, entrega y recordatorios

integration
→ outbox, simulador PACS e importación heredada
```

## Frontera de hardware

El frontend nunca habla directamente con el molinete. Un adapter transforma eventos del fabricante al contrato canónico del backend. Hasta recibir documentación real se usa un worker mock no productivo.

```text
molinete/lector
→ adapter del fabricante
→ evento canónico idempotente
→ worker de acceso
→ motor de decisión
→ resultado persistido
→ adapter aplica apertura/denegación
```

El dominio no conoce protocolos, SDKs ni payloads propietarios.

## Biometría

GymSheet no almacena muestras ni templates biométricos. Conserva únicamente referencias externas opacas y metadata de ciclo de vida. Esta minimización sigue la frontera definida en `ADR-0002` y el threat model.

## Consistencia

- Mutaciones y outbox se escriben en la misma transacción.
- Los workers asumen entrega al menos una vez.
- Claims y deduplicación se respaldan con constraints PostgreSQL.
- Recordatorios y eventos físicos tienen claves de idempotencia estables.
- Las decisiones de acceso se calculan con estado actual, no con datos confiados del dispositivo.

## Compatibilidad

Los endpoints v1 de entrenamiento se preservan. Los nuevos módulos se añaden sin cambiar contratos existentes. `equipos_gym` recibe campos opcionales de ubicación e inventario mediante migración incremental.

## Supuestos y faltantes

- No existe `domainModel.puml`; los diagramas originales cubren únicamente entrenamiento.
- El fabricante y protocolo del molinete son desconocidos.
- El contrato del backend heredado no fue entregado.
- El proveedor de mensajería externo no fue definido.
- La exportación PDF sigue fuera del alcance actual.

Los faltantes se aíslan mediante adapters y contratos canónicos, no mediante lógica condicional dispersa.
