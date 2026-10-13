# workouts

Núcleo de registro rápido de entrenamiento.

Reglas clave:

- Solo sesiones `EN_PROGRESO` admiten cambios.
- El énfasis se guarda en el ejercicio dentro de la sesión, no en cada serie.
- No se permite repetir `numeroSerie` dentro del mismo `sesionEjercicioId`.
- Una serie **saltada** (`series_saltadas`) no es una serie: tiene motivo, se muestra y se puede deshacer, pero no
  cuenta para volumen, récords, puntos ni progresión. Registrar la serie de ese número borra la saltada.
- Un ejercicio **omitido** (`sesiones_ejercicios.omitido_*`) conserva las series que tuviera.
- `finish` y `cancel` son idempotentes: `finish` guarda su respuesta en `resultado_cierre` y la repite
  (`yaFinalizada: true`); el cierre real lo gana una sola petición (`claimSessionClose`).
- El descanso y el intervalo ajustados a mano se guardan en la sesión con `PATCH /workouts/:id/rest-settings`
  (controlador en `training/`, porque puede escribir también en la rutina propia).
