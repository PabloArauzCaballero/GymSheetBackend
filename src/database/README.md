# database

Configura Sequelize y registra los modelos del dominio.

La sincronización destructiva de Sequelize permanece desactivada. Antes de crear la aplicación,
el bootstrap aplica idempotentemente `docs/db/schema.sql`, ejecuta las migraciones pendientes y
actualiza el seed base. En `development` también actualiza los seeds mock; en los demás ambientes
solo ejecuta el seed base.
