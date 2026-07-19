# ADR-0002 — Frontera de control de acceso físico y biometría

Estado: aceptado  
Fecha: 2026-07-19

## Contexto

GymSheet debe administrar membresías y decidir si una persona puede ingresar o salir mediante un molinete que admite PIN, rostro y huella. El fabricante, protocolo, firmware, topología, formato de eventos y capacidades de seguridad todavía no están confirmados.

Acoplar el API web al hardware ahora introduciría dependencias falsas y riesgo operativo. Además, rostro y huella son datos sensibles que no pueden tratarse como contraseñas reemplazables.

## Decisión

Se adopta una frontera PACS independiente:

```text
hardware o simulador
→ adapter específico
→ AccessDeviceEvent canónico
→ cola persistente
→ AccessDecisionService
→ AccessDecision
→ respuesta canónica al adapter
```

Reglas:

1. El dominio nunca importa SDKs del fabricante.
2. El API web no abre el molinete directamente.
3. El mock implementa el mismo contrato canónico que el futuro adapter.
4. No se guardan imágenes, capturas, minucias ni plantillas biométricas.
5. Se guarda una referencia opaca emitida por el sistema biométrico, estado, consentimiento y trazabilidad.
6. El PIN se persiste como hash; no se escribe en colas, eventos, auditoría ni logs.
7. Cada evento físico trae `sourceEventId`; una restricción única garantiza idempotencia.
8. La decisión distingue autenticación de autorización. El hardware/adapter autentica la credencial; GymSheet autoriza según usuario, trabajador, plan, membresía, sede, sala y punto de acceso.
9. La integración real debe usar canal autenticado y protegido. Cuando el hardware lo permita se preferirá OSDP Secure Channel sobre protocolos heredados sin supervisión.
10. El mock y sus endpoints quedan bloqueados por configuración en producción.

## Consecuencias

Positivas:

- permite probar el flujo completo sin hardware;
- evita que el frontend se acople al molinete;
- reduce exposición biométrica;
- facilita cambiar de fabricante;
- preserva auditoría e idempotencia;
- permite escalar workers separados del API.

Costos:

- se requieren tablas de cola, decisiones y credenciales;
- el adapter real necesita una fase de homologación;
- no puede afirmarse compatibilidad con el equipo hasta recibir documentación y muestras reales.

## Referencias técnicas

- ISO/IEC 24745:2022, protección de información biométrica.
- NIST SP 800-63B-4, requisitos y límites para uso de biometría.
- IEC 60839-11-1, requisitos de sistemas electrónicos de control de acceso.
- IEC 60839-11-5 y SIA OSDP para comunicación de dispositivos.
