# Informe de pruebas de la ampliación

Evidencia ejecutada el 22 de julio de 2026:

- Docker: API, PostgreSQL y Redis saludables; API publicada en `localhost:3001`.
- Migración `202607220002-customer-experience` aplicada en PostgreSQL.
- Seeds `all` ejecutados dos veces: `created=0`, `updated=0`, `unchanged=10` en ambas corridas.
- Sincronización externa repetida: 1.324 leídos y válidos, 0 insertados, 0 actualizados, 1.324 omitidos, 0 rechazados y 0 errores.
- Persistencia: 1.324 ejercicios externos y 1.324 `external_id` únicos; 3 planes y 3 imágenes comerciales.
- Onboarding: `NOT_STARTED → COMPLETED`; segunda finalización y repetición del peso idempotentes.
- Membresía: activa con accesos; vencida con opciones; intención WhatsApp repetible sin conceder acceso; pendiente separada de activación.
- Backend: TypeScript, ESLint y 132/132 pruebas Jest aprobadas.
- Frontend: TypeScript, ESLint, 21/21 pruebas Vitest y build Next.js de producción aprobados.
- E2E: 14/14 recorridos Playwright aprobados en Chromium desktop y Pixel 7.
- Verificación visual: login renderizado sin pantalla vacía ni overlay; captura en `test-results/visual-login.png`.

La suite E2E usa un solo worker para evitar que el throttling de autenticación convierta accesos simultáneos con las mismas cuentas mock en resultados no deterministas.
