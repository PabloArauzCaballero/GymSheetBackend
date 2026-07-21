# Gobernanza

- No inventes archivos, comandos, librerías ni plugins. Si algo falta, decláralo faltante.
- Detente antes de acciones irreversibles: migraciones destructivas, `git push`, OAuth, uso de
  secretos, acceso a producción, creación de recursos cloud, aceptación de costos.
- Ante una contradicción crítica entre reglas o requisitos, detente y preséntala antes de modificar.
- Preserva comportamiento: no elimines funcionalidad que ya trabaja ni cambies contratos públicos sin
  evaluar compatibilidad.
- Cambios de versión mayor de dependencias o del stack requieren ADR (`docs/decisions/`).
- No declares una fase terminada sin evidencia ejecutada. Fuente de precedencia y comandos: `CLAUDE.md`.
