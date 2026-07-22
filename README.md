# GymSheet Backend

Backend NestJS para una aplicación web sencilla de registro de entrenamientos en gimnasio.

El objetivo del sistema es que el cliente del gimnasio registre ejercicios, series, repeticiones, peso, RIR, descanso anterior y énfasis del día sin fricción.

## Stack

- NestJS
- TypeScript
- Sequelize + sequelize-typescript
- PostgreSQL
- Zod
- JWT
- Rate limiter global
- API Gateway interno documentado

## Instalación

```bash
yarn install --frozen-lockfile
cp .env.example .env
yarn start:dev
```

## Base de datos

El DDL principal está en:

```txt
docs/db/schema.sql
```

Ejecuta ese archivo en PostgreSQL antes de levantar el backend si no usarás migraciones automatizadas.

## Scripts principales

```bash
yarn start:dev
yarn build
yarn start:prod
yarn type-check
yarn test
yarn migration:up
yarn db:seed:base
```

## Documentación

```txt
docs/architecture/architecture.md
docs/architecture/flows.md
docs/endpoints/endpoints.md
docs/endpoints/openapi.yaml
docs/postman/collection.json
```
