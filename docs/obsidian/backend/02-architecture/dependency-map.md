---
title: "Mapa de dependencias"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Mapa de dependencias

Grafo de importación entre módulos de dominio. Detalle tabular y exports en
[[02-architecture/module-boundaries]].

```mermaid
flowchart LR
  auth --> users
  exercises --> equipment
  workouts --> exercises
  training --> exercises
  training --> workouts
  export --> users
  export --> profiles
  export --> workouts
  export --> equipment
  facilities --> equipment
  facilities --> integration
  accred[access-credential] --> users
  accontrol[access-control] --> membership
  accontrol --> accred
  accontrol --> integration
  notifications --> integration
  membership --> accred
  membership --> facilities
  membership --> integration
  membership --> notifications
  membership --> users
  health --> integration
```

## Lectura

- **Sentido de las flechas**: A → B significa "A importa a B" (A depende de B).
- **Sumideros (hojas)**: `integration`, `users`, `equipment`, `profiles` — no dependen de nadie.
- **`integration`** concentra las flechas entrantes (hub del outbox). Un fallo o cambio de contrato
  aquí impacta 5 módulos.
- **Aciclicidad**: no hay ciclos; ningún `forwardRef()`. El orden de arranque de módulos es
  topológicamente estable.

> Nota: `access-control` (nodo `accontrol`) y `access-credential` (`accred`) viven en el mismo
> directorio; solo el primero se registra en `AppModule`.

Ver [[02-architecture/views/c4-component]] para la vista por capas.
