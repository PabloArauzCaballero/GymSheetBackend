# Flujos principales

## Registro e inicio de sesión

1. El usuario se registra con email, contraseña y nombre completo.
2. La contraseña se hashea con bcrypt.
3. El sistema devuelve un JWT Bearer.
4. Las rutas privadas usan el guard JWT global.

## Perfil antropométrico

1. El usuario autenticado consulta `/profile`.
2. Si no existe perfil, el sistema responde `404`.
3. El usuario crea o actualiza edad, peso, estatura y objetivo.

## Ejercicios

1. El usuario consulta ejercicios visibles.
2. La consulta retorna ejercicios `GLOBAL` activos y ejercicios `PERSONAL` activos creados por ese usuario.
3. El administrador crea ejercicios globales en `/admin/exercises/global`.
4. El usuario crea ejercicios personales en `/exercises/personal`.
5. Solo el dueño puede editar o inhabilitar sus ejercicios personales.

## Entrenamiento

1. El usuario inicia sesión de entrenamiento en `/workouts`.
2. Agrega ejercicios a la sesión.
3. Marca `esEnfasis` a nivel de ejercicio de sesión.
4. Registra series con número, repeticiones, peso, RIR y descanso anterior.
5. El sistema impide duplicar el mismo `numeroSerie` dentro de un mismo `sesionEjercicioId`.
6. Al finalizar, la sesión pasa a `FINALIZADA` y ya no permite modificaciones normales.

## Exportación

1. El usuario solicita `/export/workout-history` o `/export/workout-history/csv`.
2. El sistema incluye usuario, perfil, sesiones, ejercicios, series y catálogo disponible.
3. La salida está orientada a revisión por entrenador externo.

## Workers

No se generaron workers porque el sistema no define colas ni tareas asíncronas. Si en una fase posterior se agrega envío de correos, PDF pesado o notificaciones, deberán implementarse como procesos persistentes independientes del API.
