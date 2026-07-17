# Runbook de contención y rotación de secretos

## Situación

El repositorio contenía un archivo de entorno versionado con credenciales de base de datos y claves de firma JWT. Considere esos valores comprometidos aunque el archivo se elimine del último commit.

## Acciones inmediatas

1. Cambiar la contraseña del rol PostgreSQL expuesto.
2. Generar claves criptográficamente aleatorias e independientes para access y refresh tokens.
3. Desplegar los nuevos valores mediante el secret manager de la plataforma.
4. Invalidar sesiones existentes.
5. Revisar logs de conexión y auditoría desde la primera fecha del commit afectado.
6. Verificar que ningún secreto aparezca en Actions, Docker layers, artefactos, capturas o documentación.

## Purga del historial

La rama `HARDENING` solo elimina el archivo del HEAD. Para retirar su contenido del historial se requiere una operación separada y destructiva:

- respaldar el repositorio;
- coordinar una ventana de mantenimiento;
- usar `git filter-repo` o BFG para eliminar el archivo de todas las referencias;
- actualizar ramas y tags autorizados;
- pedir a colaboradores que reclonen;
- ejecutar secret scanning después de la reescritura.

No automatizar la reescritura desde el backend ni desde un pull request normal.

## Prevención

- Mantener archivos de entorno ignorados y versionar únicamente `.env.example`.
- Activar secret scanning y push protection.
- Usar credenciales distintas por entorno y roles PostgreSQL de mínimo privilegio.
- No registrar Authorization, cookies, passwords, tokens ni cadenas de conexión.
