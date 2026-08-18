# Seeds de membresía para desarrollo

`yarn db:seed:mock` está prohibido en producción. Crea usuarios para onboarding nuevo/incompleto, membresía activa/próxima/vencida y renovación pendiente, usando modelos productivos.

Incluye planes mensual, trimestral y anual marcados `· Desarrollo`, precios BOB no comerciales, tres features y portadas ORM con claves estables. Evidencia: dos ejecuciones consecutivas reportaron `created=0`, `updated=0`, `unchanged=9`.
