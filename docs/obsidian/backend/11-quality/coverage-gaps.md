---
title: "Brechas de cobertura de pruebas"
type: audit
status: inferred
criticality: medium
last_reviewed: "2026-08-06"
tags: [backend, quality, gaps]
---

# Brechas de cobertura de pruebas

> INFERIDO por análisis estático del árbol de tests (rev 27f3fd2). No se ejecutó cobertura instrumentada.

| Área | Cobertura observada | Gap |
|---|---|---|
| Auth / autorización | E2E dedicado | Baja: cubierto |
| Propiedad de workouts | E2E dedicado | Baja: cubierto |
| Membership / entitlements | Unit parcial | Sin E2E de renovación/extensión + outbox |
| Access-control / decisiones | Unit parcial | Sin E2E de flujo de acceso físico |
| Outbox / workers | Unit (métricas/retención) | Sin prueba de idempotencia/DLQ end-to-end |
| Notificaciones / gateway | Unit parcial | Sin prueba de failure modes del gateway (SSRF, timeout) |
| Contrato OpenAPI | — | Sin contract tests |

Ver [[11-quality/testing-strategy]] · [[14-audits/technical-debt]].
