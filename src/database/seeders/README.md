# Seeders

Los seeds usan Sequelize, la misma configuración del runtime y claves naturales
estables (correo). Pueden repetirse: actualizan únicamente los campos gestionados
por el seed y nunca crean duplicados.

```bash
yarn db:seed:base
yarn db:seed:mock
yarn db:seed:all:development
```

El seed base requiere `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`. El seed mock
requiere `SEED_MOCK_PASSWORD` y se niega a ejecutar con `NODE_ENV=production`.
Las contraseñas se reciben por entorno, se almacenan como hash bcrypt y nunca se
incluyen en logs. Los usuarios mock cubren entrenador, atleta y usuario inactivo.

Seeders opcionales para usuarios administradores y catálogo inicial.
