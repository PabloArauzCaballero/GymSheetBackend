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
- **Rutina libre** (`POST /workouts/libre`): zonas opcionales (`grupos`: CHEST, BACK, SHOULDERS, ARMS,
  CORE, LEGS, GLUTES, CALVES) y tamaño (`ejercicios`, 3–10, por defecto 6). Sin zonas, cuerpo completo.
  Reparte por turnos entre zonas, prefiere favoritos y músculo principal, nunca repite ni propone ejercicios
  personales ajenos. La sesión y sus ejercicios se crean en una transacción. `vacia: true` empieza en blanco.
- **Equivalentes** (`GET /workouts/session-exercises/:id/alternatives?motivo=`): por músculos compartidos
  (o mismo grupo si el ejercicio no tiene músculos enlazados), sin lo que ya está en la sesión. Con
  `MAQUINA_OCUPADA`/`SIN_EQUIPO`, los de otro equipo primero.
- **Cambiar ejercicio** (`POST /workouts/session-exercises/:id/swap`, controlador en `training/`): motivo
  obligatorio y `alcance` `SESION` (por defecto) o `RUTINA`. Sin series hechas se sustituye en su sitio; con
  series, el original las conserva y queda omitido, y el nuevo entra detrás con las series que faltan.
  `RUTINA` cambia también la fila de la rutina propia (rutina ajena → 403 `ROUTINE_NOT_OWNED` antes de tocar
  nada). Cada cambio queda en `sesiones_ejercicios_cambios` (append-only).
