# Reconciliador de `dev` → VPS

Mantiene las dos aplicaciones de GymSheet (backend y frontend) en el VPS a la altura de la punta
de `dev`, y detecta despliegues genuinamente atascados. Adaptado del reconciliador de Atlas
(mismo VPS, mismo panel de Coolify).

## Por qué existe, si ya hay autodespliegue

Hay **dos caminos, y hacen falta los dos**:

| | camino rápido | red de debajo (esto) |
|---|---|---|
| qué es | `.github/workflows/deploy-dev.yml` en cada repo | `reconcile-dev.sh` + temporizador de systemd |
| cuándo actúa | en el `push` | cada 15 min |
| qué NO cubre | que el build falle, que el runner muera, que un despliegue quede atascado sin avanzar | nada de eso: solo compara estado real contra GitHub y detecta atascos por tiempo |

**Incidente real, 2026-09-14:** un redeploy del frontend quedó `in_progress` 58 minutos —el VPS
estaba saturado por builds de OTROS proyectos compitiendo por CPU— y nadie, ni humano ni script,
se enteró hasta que alguien lo notó a mano casi una hora después. La versión anterior de este
script solo sabía "hay un despliegue en vuelo, no tocar" — correcto para un build lento de verdad,
pero sin límite no distingue "lento" de "muerto". `STUCK_MINUTES=50` en el script es la corrección
a ese incidente.

## Instalación (en el VPS, como root)

```bash
install -m 0755 reconcile-dev.sh /usr/local/bin/gymsheet-reconcile-dev.sh
install -m 0644 gymsheet-reconcile.service /etc/systemd/system/
install -m 0644 gymsheet-reconcile.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now gymsheet-reconcile.timer
```

## Operación

```bash
systemctl list-timers gymsheet-reconcile.timer     # cuándo dispara el próximo
systemctl status gymsheet-reconcile.service        # rojo = ATASCO real o ERROR
journalctl -u gymsheet-reconcile.service -n 50      # qué vio en las últimas pasadas
sudo systemctl start gymsheet-reconcile.service     # forzar una pasada ahora
```

Una pasada normal se lee así:

```
OK     gymsheet-backend: al dia en 07a4ddb7e7
VUELO  gymsheet-frontend: 59f99dd606 -> a332390b85, ya hay despliegue en curso (3 min)
resumen: 1 al dia, 1 en vuelo, 0 encolados, 0 atascados, 0 cancelados por atasco, 0 errores
```

Y una pasada que detecta un atasco real:

```
ATASCO gymsheet-frontend: despliegue #544 lleva 58 min in_progress (>= 50), cancelando
DESFASE gymsheet-frontend: 59f99dd606 -> a332390b85, encolando (intento 1)
resumen: 0 al dia, 0 en vuelo, 1 encolados, 0 atascados, 1 cancelados por atasco, 0 errores
```

### Si sale `ATASCO` por fallos repetidos (no por tiempo)

El commit falló dos veces. **No lo reencoles a mano sin mirar antes el log del build en
Coolify**: si falla dos veces seguidas suele ser el código o una variable, no un tropiezo. Cuando
esté arreglado, el commit siguiente a `dev` reinicia la cuenta por sí solo.

### Si cancela un despliegue por atasco de tiempo

`STUCK_MINUTES=50` da margen sobre el pico de ~27 min que Atlas midió en esta máquina bajo carga
alta. Si esto empieza a disparar con builds que en realidad SÍ terminan (solo que más lento de lo
normal), sube el umbral en vez de desactivarlo — la alternativa (nadie se entera de un atasco de
verdad) es peor.

## Para pararlo

```bash
sudo systemctl disable --now gymsheet-reconcile.timer
```

Parar el temporizador **no** rompe el despliegue: el camino rápido de GitHub Actions sigue igual.

## Mantener sincronizado

Este directorio es la fuente de verdad versionada. El script instalado en
`/usr/local/bin/gymsheet-reconcile-dev.sh` en el VPS puede quedar desactualizado si se edita ahí
directamente sin copiar el cambio aquí — hazlo siempre en este orden: editar aquí, probar en modo
lectura en el VPS, `install` para reemplazar el binario instalado, commitear el cambio.
