#!/usr/bin/env bash
#
# Reconciliador: deja el VPS en la punta de `dev`, pase lo que pase con el camino de subida.
#
# Adaptado del reconciliador de Atlas (AtlasBackend/tools/coolify-reconciler/reconcile-dev.sh).
# Mismo mecanismo, misma justificación: NO sustituye a `.github/workflows/deploy-dev.yml` de cada
# repo, lo COMPLEMENTA. El workflow es el camino rápido: empujas y a los pocos minutos está arriba.
# Este script es la red de debajo: cada cuarto de hora compara lo desplegado con lo que hay en
# GitHub y, si algo se quedó atrás, lo vuelve a encolar. Cubre los casos en que el camino rápido no
# llega:
#
#   - el build falló y nadie lo reintentó;
#   - Coolify se autoactualizó y mató la cola (los encolados pasan a `failed` sin haber corrido);
#   - el runner murió antes de llamar (tailscale, cuota, GitHub caído);
#   - alguien empujó con el workflow desactivado;
#   - un despliegue se quedó ATASCADO "in_progress" para siempre (ver STUCK_MINUTES abajo).
#
# NO construye nada: solo pregunta y, como mucho, le pide a Coolify que encole. El trabajo pesado
# lo sigue haciendo Coolify, de uno en uno (`concurrent_builds: 1`).
#
set -uo pipefail

# Solo estas dos. La máquina hospeda además Atlas, alovida, mantra y economic-observatory, y este
# script no debe tocarlas jamás: lo que aquí no esté listado no se mira.
APPS=(
  "gymsheet-backend|ra259tmhnvekewvxglzh91ki|GymSheetBackend"
  "gymsheet-frontend|vjrjtysanrlrd4nkfapmeup2|GymSheetFrontend"
)
DUENO=PabloArauzCaballero
RAMA=dev

# Cuántas veces se reintenta un MISMO commit antes de rendirse. Sin este tope, un commit que no
# compila se reencolaría cada cuarto de hora para siempre.
MAX_INTENTOS=2

# Minutos que un despliegue puede seguir "in_progress" antes de considerarse atascado y no un
# build lento de verdad. Se vio en producción el 2026-09-14: el `docker buildx bake` de un
# redeploy del frontend siguió "in_progress" 58 minutos sin avanzar (el VPS estaba saturado por
# builds de OTROS proyectos compitiendo por CPU), y como el reconciliador de entonces solo sabía
# "respetar lo que está en vuelo", nadie —ni humano ni script— se enteró hasta que alguien lo
# notó a mano casi una hora después. Atlas mismo documentó picos de ~27 min en esta máquina bajo
# carga alta; 50 min deja margen sobre eso sin dejar que algo genuinamente muerto viva para
# siempre. El timeout interno del workflow de GitHub Actions es de 120 min y no ayuda aquí: ese
# timeout es del RUNNER esperando una respuesta de Coolify, no de Coolify vigilándose a sí mismo.
STUCK_MINUTES=50

# El stderr de psql NO se tira: se guarda y se enseña si la consulta no devuelve nada. Un vacío
# legítimo (la aplicación de verdad no está) deja SQL_ERR vacío y el mensaje sigue siendo el de
# siempre; si hubo error de sintaxis SQL, se ve en vez de confundirse con "no está en Coolify".
SQL_ERR=$(mktemp)
trap 'rm -f "$SQL_ERR"' EXIT
sql() {
  docker exec -i coolify-db psql -U coolify -d coolify -At -F'|' -c "$1" 2>"$SQL_ERR"
}
error_sql() { tr -d '\r' < "$SQL_ERR" | grep -v '^[[:space:]]*$' | head -3 | tr '\n' ' '; }

encolar() {
  docker exec coolify php /var/www/html/artisan tinker --execute="
    \$a = App\\Models\\Application::where('uuid','$1')->first();
    if (\$a) { queue_application_deployment(application: \$a, deployment_uuid: (string) new \\Visus\\Cuid2\\Cuid2(), is_api: true); echo 'encolado'; }
    else { echo 'sin-aplicacion'; }
  " 2>/dev/null | tr -d '\r\n'
}

# Cancela el despliegue atascado en la base de datos Y detiene el contenedor helper que lo estaba
# construyendo, si sigue vivo. `docker stop` sobre un contenedor que ya no existe no es un error
# para este script (sale con 1, se ignora con `|| true`): puede que Coolify ya lo haya limpiado.
cancelar_atascado() {
  local id="$1" deployment_uuid="$2"
  sql "update application_deployment_queues set status='cancelled-by-user' where id = $id;" >/dev/null
  if [ -n "$deployment_uuid" ]; then
    docker stop "$deployment_uuid" >/dev/null 2>&1 || true
  fi
}

al_dia=0; en_vuelo=0; encolados=0; atascados=0; errores=0; cancelados=0

for fila in "${APPS[@]}"; do
  IFS='|' read -r nombre uuid repo <<<"$fila"

  # La punta de `dev` en GitHub. Los repos son públicos: sin token, sin secretos que rotar.
  tip=$(timeout 30 git ls-remote "https://github.com/$DUENO/$repo" "refs/heads/$RAMA" 2>/dev/null | cut -f1)
  if [ -z "$tip" ]; then
    echo "ERROR  $nombre: no se pudo leer $RAMA de GitHub"; errores=$((errores + 1)); continue
  fi

  # Columna por columna:
  #   1. id del despliegue en vuelo (encolado o construyéndose) MÁS ANTIGUO, o vacío si no hay;
  #   2. su deployment_uuid (para poder detener el contenedor helper si hace falta);
  #   3. hace cuántos minutos entró en ese estado;
  #   4. el último commit que llegó a desplegarse bien (se excluye HEAD literal: es lo que Coolify
  #      guarda MIENTRAS el despliegue está en cola, antes de resolverlo al arrancar el build);
  #   5. cuántas veces ha fallado ya ESTE commit (alimenta el tope de intentos). Los fallos con
  #      commit = HEAD no cuentan: son despliegues que murieron ANTES de arrancar el build, y no
  #      dicen nada sobre si el commit está roto.
  lectura=$(sql "
    select
      coalesce((select d.id::varchar from application_deployment_queues d
         where d.application_id = a.id::varchar and d.status in ('queued','in_progress')
         order by d.id asc limit 1), ''),
      coalesce((select d.deployment_uuid from application_deployment_queues d
         where d.application_id = a.id::varchar and d.status in ('queued','in_progress')
         order by d.id asc limit 1), ''),
      coalesce((select extract(epoch from (now() - d.created_at)) / 60 from application_deployment_queues d
         where d.application_id = a.id::varchar and d.status in ('queued','in_progress')
         order by d.id asc limit 1), 0),
      coalesce((select d.commit from application_deployment_queues d
         where d.application_id = a.id::varchar and d.status = 'finished'
           and d.commit is not null and d.commit <> 'HEAD'
         order by d.id desc limit 1), ''),
      (select count(*) from application_deployment_queues d
         where d.application_id = a.id::varchar and d.status = 'failed' and d.commit = '$tip')
    from applications a where a.uuid = '$uuid';")

  if [ -z "$lectura" ]; then
    detalle=$(error_sql)
    if [ -n "$detalle" ]; then
      echo "ERROR  $nombre: la consulta a Coolify falló: $detalle"
    else
      echo "ERROR  $nombre: no está en Coolify"
    fi
    errores=$((errores + 1)); continue
  fi
  IFS='|' read -r vuelo_id vuelo_deploy_uuid vuelo_minutos desplegado fallos <<<"$lectura"
  vuelo_minutos_entero=${vuelo_minutos%.*}

  if [ -n "$vuelo_id" ] && [ "${vuelo_minutos_entero:-0}" -ge "$STUCK_MINUTES" ]; then
    echo "ATASCO $nombre: despliegue #$vuelo_id lleva ${vuelo_minutos_entero} min in_progress (>= ${STUCK_MINUTES}), cancelando"
    cancelar_atascado "$vuelo_id" "$vuelo_deploy_uuid"
    cancelados=$((cancelados + 1))
    vuelo_id=""  # cae al flujo normal de abajo: si sigue desfasado, se re-encola en esta misma pasada
  fi

  if [ "$desplegado" = "$tip" ]; then
    echo "OK     $nombre: al día en ${tip:0:10}"; al_dia=$((al_dia + 1)); continue
  fi
  if [ -n "$vuelo_id" ]; then
    echo "VUELO  $nombre: ${desplegado:0:10} -> ${tip:0:10}, ya hay despliegue en curso (${vuelo_minutos_entero} min)"
    en_vuelo=$((en_vuelo + 1)); continue
  fi
  if [ "${fallos:-0}" -ge "$MAX_INTENTOS" ]; then
    echo "ATASCO $nombre: ${tip:0:10} falló $fallos veces, NO se reintenta (mira el log del build)"
    atascados=$((atascados + 1)); continue
  fi

  echo "DESFASE $nombre: ${desplegado:0:10} -> ${tip:0:10}, encolando (intento $((fallos + 1)))"
  echo "        respuesta de coolify: $(encolar "$uuid")"
  encolados=$((encolados + 1))
done

echo "resumen: $al_dia al dia, $en_vuelo en vuelo, $encolados encolados, $atascados atascados, $cancelados cancelados por atasco, $errores errores"
# Solo un ATASCO o un ERROR ponen la unidad en rojo. Un desfase recién encolado, o un atasco que
# el propio script ya canceló y reencoló, es el funcionamiento normal, no una avería que alguien
# tenga que mirar.
[ $((atascados + errores)) -eq 0 ]
