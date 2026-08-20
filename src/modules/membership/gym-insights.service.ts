import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/**
 * Las tres preguntas que el gimnasio ya se hacía y nadie podía responder.
 *
 * Se resuelven en SQL y no cargando filas a memoria. No es preferencia: el
 * histórico de series crece con cada entrenamiento de cada socio, y traerlo al
 * proceso para contarlo en JavaScript funciona en una demo y se cae el día que
 * el gimnasio lleva un año operando.
 *
 * Todo se acota a una ventana de días. Un panel sin límite temporal contesta
 * «cuánto se ha usado esto desde siempre», que no es una pregunta que ayude a
 * decidir nada; «este mes» sí.
 */
@Injectable()
export class GymInsightsService {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * Uso por máquina, con reserva.
   *
   * Un ejercicio puede apuntar a un equipo del catálogo, y la mayoría no lo
   * hace: el peso libre no tiene máquina, y el gimnasio quizá no ha registrado
   * las suyas todavía. Por eso el informe agrupa por máquina cuando la hay y
   * por ejercicio cuando no, en lugar de devolver una tabla vacía el primer
   * día. Un panel que exige configuración previa para decir algo es un panel
   * que nadie abre dos veces.
   */
  async equipmentUsage(days: number) {
    return this.sequelize.query<{
      equipoId: string | null;
      nombre: string;
      tipo: string | null;
      series: number;
      sesiones: number;
      personas: number;
    }>(
      `SELECT eq.id                                   AS "equipoId",
              COALESCE(eq.nombre, ej.nombre)          AS "nombre",
              eq.tipo                                 AS "tipo",
              COUNT(s.id)::int                        AS "series",
              COUNT(DISTINCT se.sesion_id)::int       AS "sesiones",
              COUNT(DISTINCT ses.usuario_id)::int     AS "personas"
         FROM series_entrenamiento s
         JOIN sesiones_ejercicios se ON se.id = s.sesion_ejercicio_id
         JOIN sesiones_entrenamiento ses ON ses.id = se.sesion_id
         JOIN ejercicios ej ON ej.id = se.ejercicio_id
         LEFT JOIN equipos_gym eq ON eq.id = ej.equipo_id
        WHERE ses.fecha_inicio >= NOW() - (:days * INTERVAL '1 day')
        GROUP BY eq.id, eq.nombre, eq.tipo, ej.nombre
        ORDER BY "series" DESC
        LIMIT 20`,
      { type: QueryTypes.SELECT, replacements: { days } },
    );
  }

  /**
   * Flujo de personas: lo que ocurre en la app y lo que ocurre en la puerta,
   * el mismo día y en la misma fila.
   *
   * Se devuelven juntos a propósito. Por separado cada cifra miente por
   * omisión: cien entradas físicas con quince entrenos registrados no significa
   * que la gente no entrene, significa que no está usando la app; y al revés,
   * entrenos sin entradas apunta a un lector estropeado. La comparación es el
   * dato.
   */
  async peopleFlow(days: number) {
    return this.sequelize.query<{
      dia: string;
      sesionesApp: number;
      personasApp: number;
      entradas: number;
      personasEntrada: number;
    }>(
      `WITH dias AS (
          SELECT generate_series(
                   (CURRENT_DATE - (:days - 1) * INTERVAL '1 day')::date,
                   CURRENT_DATE,
                   INTERVAL '1 day'
                 )::date AS dia
        ),
        app AS (
          SELECT ses.fecha_inicio::date AS dia,
                 COUNT(*)::int AS sesiones,
                 COUNT(DISTINCT ses.usuario_id)::int AS personas
            FROM sesiones_entrenamiento ses
           WHERE ses.fecha_inicio >= CURRENT_DATE - (:days - 1) * INTERVAL '1 day'
           GROUP BY 1
        ),
        puerta AS (
          SELECT d.decided_at::date AS dia,
                 COUNT(*)::int AS entradas,
                 COUNT(DISTINCT d.user_id)::int AS personas
            FROM access_control.decisions d
           WHERE d.outcome = 'GRANTED'
             AND d.decided_at >= CURRENT_DATE - (:days - 1) * INTERVAL '1 day'
           GROUP BY 1
        )
        SELECT to_char(dias.dia, 'YYYY-MM-DD')        AS "dia",
               COALESCE(app.sesiones, 0)              AS "sesionesApp",
               COALESCE(app.personas, 0)              AS "personasApp",
               COALESCE(puerta.entradas, 0)           AS "entradas",
               COALESCE(puerta.personas, 0)           AS "personasEntrada"
          FROM dias
          LEFT JOIN app ON app.dia = dias.dia
          LEFT JOIN puerta ON puerta.dia = dias.dia
         ORDER BY dias.dia`,
      { type: QueryTypes.SELECT, replacements: { days } },
    );
  }

  /**
   * Quién no ha renovado.
   *
   * Incluye a quien nunca tuvo membresía, no sólo a quien la dejó vencer: para
   * recepción son la misma llamada de teléfono, y separarlos en dos listas sólo
   * garantiza que una de las dos no se mire nunca.
   *
   * `DISTINCT ON` toma la membresía más reciente de cada persona; sin eso,
   * quien lleva tres años renovando aparecería tres veces.
   */
  async lapsedMembers(limit: number) {
    return this.sequelize.query<{
      usuarioId: string;
      nombreCompleto: string;
      email: string;
      telefono: string | null;
      plan: string | null;
      vencioEl: string | null;
      diasVencido: number | null;
    }>(
      `WITH ultima AS (
          SELECT DISTINCT ON (m.user_id)
                 m.user_id AS usuario_id,
                 m.ends_on AS vence_el,
                 p.name   AS plan
            FROM membership.memberships m
            LEFT JOIN membership.plans p ON p.id = m.plan_id
           ORDER BY m.user_id, m.ends_on DESC
        )
        SELECT u.id                                    AS "usuarioId",
               u.nombre_completo                       AS "nombreCompleto",
               u.email                                 AS "email",
               c.phone_number                          AS "telefono",
               ultima.plan                             AS "plan",
               to_char(ultima.vence_el, 'YYYY-MM-DD')  AS "vencioEl",
               (CURRENT_DATE - ultima.vence_el)::int   AS "diasVencido"
          FROM usuarios u
          LEFT JOIN ultima ON ultima.usuario_id = u.id
          LEFT JOIN membership.customer_profiles c ON c.user_id = u.id
         WHERE u.rol = 'CLIENTE'
           AND u.estado = 'ACTIVO'
           AND (ultima.vence_el IS NULL OR ultima.vence_el < CURRENT_DATE)
         ORDER BY ultima.vence_el DESC NULLS LAST
         LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { limit } },
    );
  }
}
