import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Género de la cuenta.
 *
 * Existe por un motivo concreto del producto: la progresión propone arquetipos
 * («eres una máquina», «eres una valquiria») y un arquetipo solo motiva si la
 * persona se reconoce en él. Sin este dato no se puede filtrar el catálogo y
 * todo el mundo recibe la misma lista genérica, que es justo lo que le quita
 * fuerza.
 *
 * Va en `usuarios` y no en el perfil antropométrico a propósito: ese perfil
 * exige peso y estatura, y obligar a medirse para poder elegir cómo te llama la
 * aplicación sería pedir un dato íntimo a cambio de otro.
 *
 * Nulo es un estado legítimo y permanente, no un formulario a medio llenar: el
 * catálogo tiene una rama neutra para quien no quiera declararlo, y las cuentas
 * que ya existen se quedan ahí sin que nadie las fuerce.
 */
const upStatements = [
  `ALTER TABLE public.usuarios
     ADD COLUMN IF NOT EXISTS genero varchar(12)`,
  `ALTER TABLE public.usuarios
     ADD CONSTRAINT ck_usuarios_genero
     CHECK (genero IS NULL OR genero IN ('MALE','FEMALE','UNSPECIFIED'))`,
] as const;

const downStatements = [
  `ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_genero`,
  `ALTER TABLE public.usuarios DROP COLUMN IF EXISTS genero`,
] as const;

export const userGenderMigration: DatabaseMigration = {
  id: "202608230002-user-gender",
  description:
    "Optional gender on user accounts so the progression catalogue can offer archetypes the user identifies with.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
