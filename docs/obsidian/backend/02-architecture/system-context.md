---
title: "Contexto del sistema (arquitectura)"
type: architecture
status: verified
last_reviewed: "2026-08-06"
source_revision: "27f3fd2"
tags: [backend, architecture]
---

# Contexto del sistema

Actores humanos y sistemas externos que interactúan con el backend. Ver también la vista C4 en
[[02-architecture/views/c4-context]] y la versión de negocio en [[01-overview/system-context]].

## Actores (roles)

| Actor | Interacción | Autenticación |
|---|---|---|
| Cliente (socio) | App/web: perfil, entrenamientos, membresía propia | JWT HS256 |
| Personal / front desk | Alta de socios, membresías, mantenimiento | JWT + rol |
| Administrador | Gestión de sedes, planes, credenciales, catálogo | JWT + rol |
| Operador / SRE | Health, métricas, despliegue | Token de métricas / red privada |

Roles concretos: ver `src/common/enums/domain.enums.ts` y [[08-security/security-overview]].

## Sistemas externos

| Sistema | Dirección | Propósito | Frontera |
|---|---|---|---|
| Molinete / lector PACS | entrante (vía adapter) | Eventos de acceso físico y biometría | ADR-0002 [[02-architecture/trust-boundaries]] |
| Gateway de notificaciones (WhatsApp) | saliente | Entrega de mensajes | HTTPS firmado + allowlist |
| Dataset de ejercicios (GitHub raw) | saliente | Refresco de catálogo + media | SSRF allowlist |
| Scraper Prometheus | entrante | Scrapea `/health/metrics` | `METRICS_SCRAPE_TOKEN` |
| Frontend SPA (origen CORS) | entrante | Cliente web | Allowlist `CORS_ORIGINS` |

## Fuera de alcance

No es plataforma de inteligencia económica ni tiene ingesta por agentes de IA. Exportación PDF y
módulo de cobros no están confirmados. Ver [[01-overview/assumptions-and-gaps]].
