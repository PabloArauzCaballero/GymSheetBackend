import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { UserRole } from "../enums/domain.enums";
import { AuthenticatedUser } from "../types/auth-context.types";

/**
 * Nivel al que se escribe una fila de catálogo.
 *
 * Sólo existe `GLOBAL` porque es la única declaración que el cliente puede
 * hacer: el gimnasio concreto NUNCA viaja en la petición —sale del token— y
 * admitirlo como valor reabriría justo el agujero que se cerró (bastaba enviar
 * `tenantId` en el cuerpo para escribir en el catálogo de otro gimnasio).
 */
export type CatalogScope = "GLOBAL";

/**
 * Traduce «quién eres» + «qué nivel declaras» al gimnasio con el que se escribe
 * o se filtra una fila de catálogo. `null` = catálogo global.
 *
 * Se pide una declaración explícita en vez de deducirla porque los dos niveles
 * que un administrador de plataforma puede tocar son indistinguibles desde
 * fuera y el error es silencioso en la dirección peligrosa: una fila global mal
 * creada aparece en TODOS los gimnasios y nadie la reclama como suya. Por eso
 * ninguna fila tiene nivel por defecto — omitirlo siendo supra-inquilino es un
 * 400, no una suposición.
 *
 * | actor                                | `alcance`  | resultado          |
 * |--------------------------------------|------------|--------------------|
 * | ADMIN de gimnasio                    | omitido    | su gimnasio        |
 * | ADMIN de gimnasio                    | `GLOBAL`   | **403**            |
 * | SYSTEM_ADMIN suplantando             | omitido    | gimnasio suplantado|
 * | SYSTEM_ADMIN suplantando             | `GLOBAL`   | **400**            |
 * | SYSTEM_ADMIN sin suplantar           | `GLOBAL`   | catálogo global    |
 * | SYSTEM_ADMIN sin suplantar           | omitido    | **400**            |
 */
export function resolveCatalogTenant(
  actor: AuthenticatedUser,
  alcance: CatalogScope | undefined,
): string | null {
  if (actor.tenantScope === null) {
    // Supra-inquilino sin suplantar: no tiene «su» gimnasio al que caer.
    if (alcance === "GLOBAL") return null;
    throw new BadRequestException(
      "Declara `alcance: \"GLOBAL\"` para el catálogo compartido, o suplanta un gimnasio para editar el suyo.",
    );
  }

  if (alcance === "GLOBAL") {
    if (actor.role === UserRole.SYSTEM_ADMIN) {
      // Suplantando: el token está acotado a un gimnasio, así que escribir
      // global desde aquí sería contradecir el propio alcance del token. Se
      // pide salir de la suplantación en vez de ignorarla en silencio.
      throw new BadRequestException(
        "No se puede editar el catálogo global mientras se suplanta un gimnasio. Sal de la suplantación primero.",
      );
    }
    throw new ForbiddenException(
      "El catálogo global lo administra la plataforma, no un gimnasio.",
    );
  }

  return actor.tenantScope;
}
