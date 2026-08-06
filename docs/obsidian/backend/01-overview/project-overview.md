---
title: "Visión general del proyecto"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
aliases: [Project Overview]
---

# Visión general del proyecto

**GymSheet Backend** es el backend NestJS de gestión de gimnasio: entrenamientos, ejercicios,
membresías, control de acceso físico/biometría y notificaciones. **No** es plataforma de inteligencia
económica ni tiene ingesta por agentes de IA.

## Qué hace

- Gestiona **socios y personal**, sus **membresías**, planes y entitlements.
- Registra **entrenamientos** (rutinas, sesiones, sets) y un **catálogo de ejercicios** con media.
- Decide el **acceso físico** a las instalaciones a partir de eventos de dispositivo (molinete),
  minimizando datos biométricos.
- Envía **notificaciones** (recordatorios de vencimiento) por canal in-app o gateway externo.
- Expone **health y métricas** para operación.

## Cómo está construido

Monolito modular NestJS desplegado como **API + 4 workers** sobre PostgreSQL 16, con mensajería
interna por **transactional outbox** (sin broker). Redis opcional para rate limiting compartido.
Detalle: [[02-architecture/architecture-overview]] y [[01-overview/technology-stack]].

## Cifras (revisión `27f3fd2`)

- 15 módulos de dominio · ~19 controllers · ~27 services · 44 models · 10 migraciones de negocio ·
  113 rutas HTTP (46 paths en el contrato `openapi.yaml`).

## Estado y gobernanza

- Estado de producción y hallazgos: `BACKEND_AUDIT_HARDENING_AND_ACTION_PLAN.md`.
- Decisiones: `docs/decisions/ADR-0001..0005`.
- Reglas del repo: `.claude/rules/`.

Ver [[01-overview/system-context]], [[01-overview/repository-map]],
[[01-overview/assumptions-and-gaps]], [[01-overview/glossary]].
