# Corrección del catálogo atribuido a WorkoutKata

La auditoría no encontró un proveedor técnico llamado `WorkoutKata`. La fuente real y verificable es `hasaneyldrm/exercises-dataset`, configurada por `EXERCISES_DATASET_JSON_URL`. Se conserva WorkoutKata únicamente como alias del comando `yarn db:sync:workoutkata`; no se falsea la procedencia almacenada.

La causa del catálogo ausente fue local: el BFF apuntaba a `localhost:3000`, mientras el backend Docker validado escucha en `localhost:3001`. El frontend ahora usa ese backend y corre en `3002`.

La sincronización valida HTTPS, contrato, tamaño y conteo mínimo; persiste mediante Sequelize con identidad única `(data_source, external_id)`, guarda SHA-256/checkpoint y convierte snapshots idénticos en no-op. Evidencia: 1.324 filas activas y 1.324 external IDs únicos. La multimedia sigue desactivada hasta confirmar su licencia separada; la UI tiene fallback accesible.
