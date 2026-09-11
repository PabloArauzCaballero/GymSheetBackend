import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

/**
 * Cursor de la lista de "quién vio mi perfil".
 *
 * Es keyset, no OFFSET: la lista se ordena por `last_viewed_at DESC` y una
 * visita nueva mientras se pagina desplazaría todas las páginas siguientes con
 * OFFSET, repitiendo o saltándose espectadores. El cursor lleva la pareja
 * `(lastViewedAt, userId)` porque `last_viewed_at` sola no es única: dos
 * personas pueden entrar en el mismo milisegundo y sin el desempate por id la
 * paginación se quedaría en bucle o perdería filas.
 *
 * Es opaco a propósito (base64url de un JSON con versión): el cliente no debe
 * construirlo ni interpretarlo, y la versión permite cambiar el criterio de
 * orden mañana invalidando los cursores viejos en vez de servir basura.
 *
 * No contiene a quién pertenece la lista. Es deliberado: el dueño sale siempre
 * del JWT, así que un cursor manipulado no puede hacer que alguien pagine las
 * visitas de otra persona — como mucho puede mover su propia ventana.
 */
export interface ProfileViewersCursor {
  lastViewedAt: Date;
  userId: string;
}

const CURSOR_VERSION = 1;

/** Tope de tamaño: sin él, un cursor de megabytes llega hasta el JSON.parse. */
export const MAX_CURSOR_LENGTH = 300;

/** Nombres cortos (`v`, `t`, `u`) para que el token no crezca sin motivo. */
const cursorPayloadSchema = z.object({
  v: z.literal(CURSOR_VERSION),
  t: z.string().datetime(),
  u: z.string().uuid(),
});

export function encodeProfileViewersCursor(cursor: ProfileViewersCursor): string {
  const payload = {
    v: CURSOR_VERSION,
    t: cursor.lastViewedAt.toISOString(),
    u: cursor.userId,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Descodifica y valida un cursor. Entrada hostil: cualquier fallo —base64 roto,
 * JSON inválido, versión desconocida, fecha o uuid mentirosos— sale como 400 y
 * nunca como excepción sin capturar (500). Lo que llega del cliente sólo se usa
 * como valor parametrizado en la consulta, jamás concatenado.
 */
export function decodeProfileViewersCursor(raw: string): ProfileViewersCursor {
  if (raw.length > MAX_CURSOR_LENGTH) throw invalidCursor();

  let decodedJson: string;
  try {
    decodedJson = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw invalidCursor();
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decodedJson) as unknown;
  } catch {
    throw invalidCursor();
  }

  const payload = cursorPayloadSchema.safeParse(parsedJson);
  if (!payload.success) throw invalidCursor();

  const lastViewedAt = new Date(payload.data.t);
  // `z.string().datetime()` acepta formas que `Date` todavía puede rechazar
  // (por ejemplo un mes 13), así que se comprueba el resultado, no el texto.
  if (Number.isNaN(lastViewedAt.getTime())) throw invalidCursor();

  return { lastViewedAt, userId: payload.data.u };
}

function invalidCursor(): BadRequestException {
  // Sin detalle del porqué: el cliente no tiene que poder sondear el formato.
  return new BadRequestException({ message: "Cursor de paginación inválido." });
}
