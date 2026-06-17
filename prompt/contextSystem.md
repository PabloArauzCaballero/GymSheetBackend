# Contexto del sistema

## 1. Naturaleza del sistema

El sistema corresponde a una aplicación web de entrenamiento para un gimnasio, enfocada principalmente en los clientes o usuarios finales del gym.

El objetivo principal del sistema es permitir que cada usuario pueda registrar su entrenamiento de forma rápida, simple y sin fricción, evitando que el proceso sea tan largo o pesado que el usuario deje de usar la aplicación.

La aplicación no debe diseñarse como un sistema complejo de planificación deportiva avanzada, sino como una herramienta práctica para registrar series, ejercicios, pesos y progreso básico.

El sistema debe permitir registrar por cada entrenamiento:

* Ejercicio realizado.
* Número de serie.
* Repeticiones.
* Peso levantado.
* RIR.
* Si ese día el ejercicio tiene énfasis.
* Descanso respecto a la serie anterior.

Además, el sistema debe manejar parámetros antropométricos básicos del usuario:

* Edad.
* Peso corporal.
* Estatura.
* Objetivo principal de entrenamiento.

El sistema debe ser web y el backend debe construirse usando NestJS.

## 2. Contexto empresarial

El cliente es un gimnasio que necesita ofrecer a sus usuarios una aplicación sencilla para registrar sus entrenamientos.

Actualmente, muchos usuarios registran su progreso de forma manual, en notas del celular, libretas, hojas de cálculo o directamente no registran nada. Esto genera problemas como:

* Falta de seguimiento del progreso.
* Dificultad para saber cuánto peso levantó el usuario anteriormente.
* Falta de historial de repeticiones, series y cargas.
* Dificultad para compartir información clara con un entrenador externo.
* Poca adherencia al registro si la herramienta es muy compleja.
* Falta de una lista clara de máquinas, indumentaria y posibilidades reales de entrenamiento dentro del gimnasio.

La solución debe ser simple, rápida y orientada a uso real en el gym, considerando que el usuario probablemente registrará sus datos entre series, con poco tiempo y desde el celular.

## 3. Enfoque general del sistema

El sistema debe permitir que un usuario inicie sesión y pueda:

1. Completar su perfil básico.
2. Consultar ejercicios predeterminados del gimnasio.
3. Crear ejercicios personalizados en base a las máquinas o accesorios disponibles.
4. Seleccionar sus ejercicios frecuentes.
5. Iniciar una sesión de entrenamiento.
6. Registrar series rápidamente.
7. Consultar su historial.
8. Compartir o exportar información útil para un entrenador externo.

El sistema debe mantener un catálogo general del gimnasio, administrado por el admin, que incluya:

* Máquinas disponibles.
* Barras.
* Mancuernas.
* Discos.
* Poleas.
* Bancos.
* Bandas.
* Accesorios.
* Otra indumentaria útil para entrenar.

Este catálogo sirve para que el usuario y un entrenador externo conozcan las posibilidades reales de entrenamiento dentro del gimnasio.

## 4. Roles principales

El sistema debe contemplar como mínimo los siguientes roles:

```txt
ADMINISTRADOR
CLIENTE
ENTRENADOR_EXTERNO
```

### Administrador

El administrador representa al personal del gimnasio encargado de configurar la información base del sistema.

Puede:

* Gestionar máquinas.
* Gestionar indumentaria.
* Gestionar accesorios del gimnasio.
* Crear ejercicios predeterminados.
* Editar ejercicios predeterminados.
* Inhabilitar ejercicios predeterminados.
* Consultar información general de uso si el alcance lo requiere.

### Cliente / Usuario final

El cliente es el usuario principal de la aplicación.

Puede:

* Iniciar sesión.
* Registrar su perfil básico.
* Ver ejercicios predeterminados.
* Crear ejercicios personalizados.
* Seleccionar ejercicios frecuentes.
* Iniciar una sesión de entrenamiento.
* Registrar series.
* Editar series.
* Finalizar entrenamientos.
* Consultar su historial.
* Exportar información para un entrenador externo.

### Entrenador externo

El entrenador externo no necesariamente administra la aplicación.

Su participación puede darse mediante información exportada por el usuario, donde pueda revisar:

* Ejercicios realizados.
* Series.
* Repeticiones.
* Peso levantado.
* RIR.
* Descansos.
* Ejercicios personalizados.
* Máquinas e indumentaria disponibles en el gimnasio.

## 5. Principio central del sistema

La regla más importante del sistema es:

```txt
REGISTRO RÁPIDO > FUNCIONALIDAD COMPLEJA
```

El usuario debe poder registrar una serie en pocos segundos.

El sistema debe evitar formularios largos, pasos innecesarios o campos demasiado técnicos.

La experiencia ideal es que el usuario pueda registrar algo como:

```txt
Ejercicio: Press banca

Serie | Reps | Peso | RIR | Descanso anterior
1     | 10   | 60kg | 2   | 0s
2     | 8    | 65kg | 1   | 90s
3     | 8    | 65kg | 1   | 120s
```

El campo “énfasis del día” no debe repetirse en cada serie. Debe marcarse a nivel del ejercicio dentro de la sesión de entrenamiento.

Por ejemplo:

```txt
Sesión de entrenamiento
  └── Press banca
        ├── Es énfasis: Sí
        ├── Serie 1
        ├── Serie 2
        └── Serie 3
```

## 6. Ejercicios predeterminados y personalizados

El sistema debe diferenciar entre dos tipos de ejercicios:

```txt
GLOBAL
PERSONAL
```

### Ejercicio GLOBAL

Es un ejercicio predeterminado creado por el administrador del gimnasio.

Características:

* Visible para todos los usuarios.
* Forma parte del catálogo base del gym.
* Puede estar asociado a una o varias máquinas o accesorios.
* Puede ser editado o inhabilitado por el administrador.

Ejemplos:

```txt
Press banca
Sentadilla en multipower
Jalón al pecho
Remo en polea baja
Prensa de piernas
Curl femoral sentado
```

### Ejercicio PERSONAL

Es un ejercicio creado por el usuario final.

Características:

* Solo es visible para el usuario que lo creó.
* Puede estar basado en máquinas, poleas, mancuernas o accesorios disponibles.
* No modifica el catálogo global del gimnasio.
* Permite registrar variantes reales de entrenamiento.

Ejemplos:

```txt
Press inclinado en máquina con agarre cerrado
Remo unilateral en polea baja
Curl en polea con cuerda propia
Extensión de tríceps en máquina usando banco
```

La regla de visibilidad debe ser:

```txt
El usuario ve ejercicios GLOBAL + sus propios ejercicios PERSONAL.
```

Consulta lógica sugerida:

```sql
SELECT *
FROM ejercicios
WHERE estado = 'ACTIVO'
AND (
  tipo_ejercicio = 'GLOBAL'
  OR created_by_usuario_id = :usuarioId
);
```

## 7. Perfil básico del usuario

El sistema debe manejar únicamente datos antropométricos básicos.

No se debe convertir esta app en una plataforma médica ni en una app avanzada de nutrición.

Datos requeridos:

* Edad.
* Peso corporal en kg.
* Estatura en cm.
* Objetivo principal.

Objetivos sugeridos:

```txt
HIPERTROFIA
FUERZA
RESISTENCIA
PERDIDA_GRASA
SALUD_GENERAL
REHABILITACION
```

Estos datos sirven para dar contexto al historial del usuario, no para generar diagnósticos médicos.

## 8. Sesión de entrenamiento

La sesión de entrenamiento representa un entrenamiento realizado por el usuario en una fecha determinada.

Debe contener:

* Usuario.
* Fecha y hora de inicio.
* Fecha y hora de finalización.
* Estado.
* Observación opcional.

Estados sugeridos:

```txt
EN_PROGRESO
FINALIZADA
CANCELADA
```

Una sesión puede tener muchos ejercicios.

Cada ejercicio dentro de una sesión puede tener muchas series.

## 9. Ejercicio dentro de una sesión

El ejercicio dentro de una sesión representa que el usuario realizó un ejercicio específico durante ese entrenamiento.

Debe contener:

* Sesión de entrenamiento.
* Ejercicio.
* Orden dentro de la sesión.
* Si es énfasis del día.
* Nota opcional.

El campo `esEnfasis` debe estar aquí y no en la serie, porque el énfasis corresponde al ejercicio del día, no a cada serie individual.

Ejemplo:

```txt
Día torso
- Press banca: énfasis Sí
- Jalón al pecho: énfasis No
- Press militar: énfasis No
```

## 10. Serie de entrenamiento

La serie de entrenamiento es el registro principal del sistema.

Debe contener:

* Ejercicio dentro de la sesión.
* Número de serie.
* Repeticiones.
* Peso levantado.
* RIR.
* Descanso respecto a la serie anterior.
* Fecha y hora de registro.

Reglas de validación:

```txt
repeticiones > 0
peso_kg >= 0
rir >= 0 AND rir <= 10
descanso_seg_anterior >= 0
```

También se debe evitar duplicar el mismo número de serie dentro del mismo ejercicio de sesión:

```txt
UNIQUE (sesion_ejercicio_id, numero_serie)
```

## 11. Catálogo de máquinas e indumentaria

El sistema debe manejar un catálogo de recursos físicos disponibles en el gimnasio.

Este catálogo debe incluir:

* Máquinas.
* Mancuernas.
* Barras.
* Discos.
* Poleas.
* Bancos.
* Bandas.
* Accesorios.
* Otra indumentaria útil.

Entidad sugerida:

```txt
EquipoGym
```

Campos sugeridos:

* ID.
* Nombre.
* Tipo.
* Descripción.
* Estado.

Tipos sugeridos:

```txt
MAQUINA
MANCUERNA
BARRA
DISCO
BANCO
POLEA
BANDA
ACCESORIO
OTRO
```

Estados sugeridos:

```txt
DISPONIBLE
MANTENIMIENTO
INACTIVO
```

El objetivo de esta información es que el usuario o entrenador externo conozca qué posibilidades reales existen dentro del gimnasio.

## 12. Relación entre ejercicios y equipos

Un ejercicio puede usar uno o varios equipos.

Una máquina o accesorio puede estar asociado a muchos ejercicios.

Por lo tanto, debe existir una relación muchos a muchos:

```txt
EjercicioEquipo
```

Ejemplos:

```txt
Press banca
  → Banco plano
  → Barra olímpica
  → Discos

Jalón al pecho
  → Polea alta
  → Barra larga

Curl en polea
  → Polea baja
  → Cuerda
```

Esto permite que el sistema pueda mostrarle a un entrenador externo no solo qué ejercicio realizó el usuario, sino también con qué máquina o accesorio lo hizo.

## 13. Funcionalidades principales del usuario

El usuario debe poder:

```txt
1. Iniciar sesión.
2. Completar perfil básico.
3. Ver ejercicios predeterminados.
4. Crear ejercicios personalizados.
5. Ver máquinas e indumentaria disponible.
6. Seleccionar ejercicios frecuentes.
7. Iniciar entrenamiento.
8. Agregar ejercicio a la sesión.
9. Marcar ejercicio como énfasis del día.
10. Registrar serie.
11. Editar serie.
12. Eliminar serie.
13. Finalizar entrenamiento.
14. Consultar historial.
15. Exportar información para entrenador externo.
```

## 14. Funcionalidades principales del administrador

El administrador debe poder:

```txt
1. Iniciar sesión.
2. Gestionar máquinas.
3. Gestionar accesorios.
4. Gestionar indumentaria del gimnasio.
5. Crear ejercicios predeterminados.
6. Editar ejercicios predeterminados.
7. Inhabilitar ejercicios predeterminados.
8. Consultar catálogo general.
```

El administrador no debe ser el único que puede crear ejercicios.

El administrador crea ejercicios globales, pero el usuario final también puede crear ejercicios personales.

## 15. Exportación para entrenador externo

El sistema debe permitir exportar o compartir información útil para que un entrenador externo pueda entender el contexto del usuario.

La exportación debe incluir:

* Datos básicos del usuario.
* Objetivo.
* Historial de entrenamientos.
* Ejercicios realizados.
* Series.
* Repeticiones.
* Peso levantado.
* RIR.
* Descansos.
* Ejercicios marcados como énfasis.
* Ejercicios personalizados.
* Máquinas e indumentaria asociada.
* Catálogo disponible del gimnasio, si aplica.

No es obligatorio que el entrenador externo tenga una cuenta en la primera versión. Puede bastar con una exportación en PDF, CSV o una vista compartible.

## 16. Entidades principales del dominio

Entidades mínimas sugeridas:

```txt
Usuario
PerfilAntropometrico
EquipoGym
Ejercicio
EjercicioEquipo
UsuarioEjercicio
SesionEntrenamiento
SesionEjercicio
SerieEntrenamiento
```

### Usuario

Representa a la persona que usa el sistema.

Campos sugeridos:

* id.
* email.
* passwordHash.
* nombreCompleto.
* rol.
* estado.
* fechaRegistro.

### PerfilAntropometrico

Representa los datos físicos básicos del usuario.

Campos sugeridos:

* id.
* usuarioId.
* edad.
* pesoKg.
* estaturaCm.
* objetivo.
* fechaActualizacion.

### EquipoGym

Representa máquinas, accesorios e indumentaria.

Campos sugeridos:

* id.
* nombre.
* tipo.
* descripcion.
* estado.

### Ejercicio

Representa un ejercicio global o personal.

Campos sugeridos:

* id.
* nombre.
* grupoMuscular.
* descripcion.
* tipoEjercicio.
* createdByUsuarioId.
* estado.

### EjercicioEquipo

Relaciona ejercicios con máquinas o accesorios.

Campos sugeridos:

* id.
* ejercicioId.
* equipoGymId.

### UsuarioEjercicio

Representa los ejercicios seleccionados o frecuentes de un usuario.

Campos sugeridos:

* id.
* usuarioId.
* ejercicioId.
* fechaSeleccion.

### SesionEntrenamiento

Representa una sesión de entrenamiento.

Campos sugeridos:

* id.
* usuarioId.
* fechaInicio.
* fechaFin.
* estado.
* observacion.

### SesionEjercicio

Representa un ejercicio realizado dentro de una sesión.

Campos sugeridos:

* id.
* sesionId.
* ejercicioId.
* orden.
* esEnfasis.
* nota.

### SerieEntrenamiento

Representa una serie registrada por el usuario.

Campos sugeridos:

* id.
* sesionEjercicioId.
* numeroSerie.
* repeticiones.
* pesoKg.
* rir.
* descansoSegAnterior.
* fechaRegistro.

## 17. Reglas de negocio principales

El sistema debe cumplir estas reglas:

```txt
1. El usuario debe iniciar sesión para registrar entrenamientos.
2. El usuario debe poder completar o actualizar su perfil básico.
3. El administrador puede crear ejercicios globales.
4. El usuario puede crear ejercicios personales.
5. Los ejercicios globales son visibles para todos los usuarios.
6. Los ejercicios personales solo son visibles para el usuario que los creó.
7. Todo ejercicio puede asociarse a máquinas, accesorios o indumentaria del gym.
8. El usuario puede seleccionar ejercicios globales y personales como frecuentes.
9. Una sesión de entrenamiento puede estar en progreso, finalizada o cancelada.
10. Una sesión en progreso permite agregar ejercicios y series.
11. Una sesión finalizada no debe modificarse libremente, salvo que se permita edición controlada.
12. El énfasis del día se marca por ejercicio dentro de la sesión, no por serie.
13. Una serie debe tener repeticiones mayores a cero.
14. El peso levantado no puede ser negativo.
15. El RIR debe estar entre 0 y 10.
16. El descanso anterior no puede ser negativo.
17. No debe repetirse el mismo número de serie dentro del mismo ejercicio de sesión.
18. El historial debe permitir revisar entrenamientos anteriores.
19. La exportación debe mostrar el entrenamiento de forma entendible para un entrenador externo.
20. La interfaz debe priorizar rapidez y simplicidad.
```

## 18. Alcance técnico inicial

El sistema debe desarrollarse como una aplicación web.

El backend debe desarrollarse en:

```txt
NestJS
```

Base de datos recomendada:

```txt
PostgreSQL
```

Autenticación recomendada:

```txt
JWT
```

ORM recomendado:

```txt
TypeORM o Sequelize
```

El sistema puede iniciar como un monolito modular en NestJS, manteniendo una buena separación por módulos.

No es necesario iniciar con microservicios, porque el sistema es sencillo y el cliente requiere una aplicación práctica y mantenible.

Arquitectura inicial recomendada:

```txt
Frontend Web
Backend NestJS
PostgreSQL
```

## 19. Módulos recomendados en NestJS

La estructura modular recomendada es:

```txt
AuthModule
UsersModule
ProfilesModule
EquipmentModule
ExercisesModule
WorkoutsModule
ExportModule
DatabaseModule
CommonModule
```

### AuthModule

Responsable de:

* Login.
* Registro.
* JWT.
* Guards.
* Estrategias de autenticación.

### UsersModule

Responsable de:

* Usuarios.
* Roles.
* Estado del usuario.

### ProfilesModule

Responsable de:

* Perfil antropométrico.
* Edad.
* Peso.
* Estatura.
* Objetivo.

### EquipmentModule

Responsable de:

* Máquinas.
* Barras.
* Mancuernas.
* Poleas.
* Bancos.
* Accesorios.
* Indumentaria disponible.

### ExercisesModule

Responsable de:

* Ejercicios globales.
* Ejercicios personales.
* Relación ejercicio-equipo.
* Ejercicios frecuentes del usuario.
* Filtros por grupo muscular.
* Filtros por máquina o accesorio.

### WorkoutsModule

Responsable de:

* Sesiones de entrenamiento.
* Ejercicios dentro de la sesión.
* Series.
* Repeticiones.
* Peso.
* RIR.
* Descanso.
* Énfasis del día.

### ExportModule

Responsable de:

* Exportar historial.
* Generar resumen para entrenador externo.
* Incluir máquinas y accesorios asociados.

### CommonModule

Responsable de:

* Enums.
* Guards comunes.
* Decoradores.
* Filtros de excepción.
* Interceptores.
* Utilidades compartidas.

## 20. Estructura de carpetas recomendada

```txt
src/
│
├── app.module.ts
├── main.ts
│
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── strategies/
│   │   └── jwt.strategy.ts
│   └── dto/
│       ├── login.dto.ts
│       └── register.dto.ts
│
├── users/
│   ├── users.module.ts
│   ├── users.controller.ts
│   ├── users.service.ts
│   ├── entities/
│   │   └── user.entity.ts
│   └── dto/
│
├── profiles/
│   ├── profiles.module.ts
│   ├── profiles.controller.ts
│   ├── profiles.service.ts
│   ├── entities/
│   │   └── anthropometric-profile.entity.ts
│   └── dto/
│
├── equipment/
│   ├── equipment.module.ts
│   ├── equipment.controller.ts
│   ├── equipment.service.ts
│   ├── entities/
│   │   └── equipment.entity.ts
│   └── dto/
│
├── exercises/
│   ├── exercises.module.ts
│   ├── exercises.controller.ts
│   ├── exercises.service.ts
│   ├── entities/
│   │   ├── exercise.entity.ts
│   │   ├── exercise-equipment.entity.ts
│   │   └── user-exercise.entity.ts
│   └── dto/
│       ├── create-global-exercise.dto.ts
│       ├── create-personal-exercise.dto.ts
│       ├── update-exercise.dto.ts
│       └── filter-exercises.dto.ts
│
├── workouts/
│   ├── workouts.module.ts
│   ├── workouts.controller.ts
│   ├── workouts.service.ts
│   ├── entities/
│   │   ├── workout-session.entity.ts
│   │   ├── workout-session-exercise.entity.ts
│   │   └── workout-set.entity.ts
│   └── dto/
│       ├── create-workout-session.dto.ts
│       ├── add-session-exercise.dto.ts
│       ├── create-workout-set.dto.ts
│       └── update-workout-set.dto.ts
│
├── export/
│   ├── export.module.ts
│   ├── export.controller.ts
│   └── export.service.ts
│
└── common/
    ├── enums/
    ├── guards/
    ├── decorators/
    ├── filters/
    └── interceptors/
```

## 21. Endpoints sugeridos

Endpoints base sugeridos:

```txt
POST   /auth/register
POST   /auth/login
GET    /auth/me
```

```txt
GET    /profile
POST   /profile
PATCH  /profile
```

```txt
GET    /equipment
POST   /admin/equipment
PATCH  /admin/equipment/:id
DELETE /admin/equipment/:id
```

```txt
GET    /exercises
GET    /exercises/:id
POST   /exercises/personal
PATCH  /exercises/:id
DELETE /exercises/:id
```

```txt
POST   /admin/exercises/global
PATCH  /admin/exercises/global/:id
DELETE /admin/exercises/global/:id
```

```txt
GET    /user-exercises
POST   /user-exercises/:exerciseId
DELETE /user-exercises/:exerciseId
```

```txt
POST   /workouts
GET    /workouts
GET    /workouts/:id
PATCH  /workouts/:id/finish
PATCH  /workouts/:id/cancel
```

```txt
POST   /workouts/:sessionId/exercises
PATCH  /workouts/session-exercises/:id
DELETE /workouts/session-exercises/:id
```

```txt
POST   /workouts/session-exercises/:id/sets
PATCH  /workouts/sets/:id
DELETE /workouts/sets/:id
```

```txt
GET    /export/workout-history
GET    /export/workout-history/pdf
GET    /export/workout-history/csv
```

## 22. Seguridad

El sistema debe manejar autenticación y autorización.

Reglas mínimas:

```txt
1. Las contraseñas deben almacenarse hasheadas.
2. El sistema debe usar JWT para proteger endpoints privados.
3. El usuario solo puede ver y modificar su propia información.
4. El usuario solo puede editar sus propios ejercicios personales.
5. El usuario no puede editar ejercicios globales.
6. El administrador puede crear, editar o inhabilitar ejercicios globales.
7. El administrador puede gestionar máquinas e indumentaria.
8. El usuario no puede acceder al historial de otro usuario.
9. Las acciones sensibles deben validar rol.
```

## 23. Experiencia de usuario esperada

La aplicación debe estar pensada para uso móvil desde navegador.

La pantalla de entrenamiento debe ser extremadamente simple.

Flujo ideal:

```txt
Abrir app
→ Iniciar entrenamiento
→ Elegir ejercicio
→ Registrar serie
→ Guardar
→ Repetir
→ Finalizar entrenamiento
```

La app debe evitar pedir información innecesaria.

El usuario no debe tener que navegar por muchas pantallas para registrar una serie.

El diseño debe favorecer:

* Botones grandes.
* Formularios cortos.
* Valores reutilizables.
* Autocompletado de ejercicios frecuentes.
* Registro rápido de la siguiente serie.
* Visualización clara del historial reciente.

## 24. Reportes e historial

El sistema debe permitir que el usuario consulte su progreso.

Consultas útiles:

```txt
Historial por fecha.
Historial por ejercicio.
Último peso usado en un ejercicio.
Mejor peso registrado.
Promedio de repeticiones.
Series realizadas por sesión.
Ejercicios con énfasis.
```

No es necesario construir analítica avanzada en la primera fase.

La prioridad es que el historial sea claro y útil.

## 25. Diagramas requeridos

El diseño debe incluir como mínimo:

```txt
1. Diagrama de casos de uso.
2. Diagrama de clases.
3. Diagrama relacional o ER.
4. Diagrama de actividad.
5. Diagrama de secuencia.
6. Diagrama de componentes.
7. Diagrama de estados.
8. Diagrama de despliegue.
```

Los diagramas deben reflejar que:

* El sistema será web.
* El backend será construido en NestJS.
* El usuario final también puede crear ejercicios.
* El administrador crea ejercicios globales.
* El sistema debe mantener simplicidad.
* El foco principal es el registro rápido de entrenamiento.

## 26. Criterio final de diseño

La solución debe diseñarse como una aplicación web sencilla, mantenible y práctica para un gimnasio real.

No debe convertirse en una plataforma deportiva excesivamente compleja.

La prioridad final debe ser:

```txt
1. Simplicidad de uso.
2. Registro rápido de series.
3. Claridad del historial.
4. Catálogo real de máquinas e indumentaria.
5. Ejercicios globales y personales.
6. Seguridad básica.
7. Backend modular en NestJS.
8. Base de datos clara en PostgreSQL.
9. Facilidad para exportar información.
10. Mantenibilidad del sistema.
```

La regla central debe mantenerse durante todo el diseño:

```txt
SI REGISTRAR UNA SERIE TOMA DEMASIADO TIEMPO, EL USUARIO DEJARÁ DE USAR LA APP.
```

Por lo tanto, toda decisión funcional, visual y técnica debe favorecer la rapidez y la comodidad del usuario final.
