import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { StoryModel } from "./story.model";
import { StoryViewModel } from "./story-view.model";
import {
  STORY_FEED_MAX_AUTHORS,
  STORY_FEED_MAX_STORIES_PER_AUTHOR,
  StoriesRepository,
} from "./stories.repository";

const viewerId = "00000000-0000-4000-8000-00000000000a";
const otherUserId = "00000000-0000-4000-8000-00000000000b";
const tenantId = "default";
const storyId = "00000000-0000-4000-8000-0000000000f1";

interface CapturedQuery {
  sql: string;
  options: { type: QueryTypes; replacements: Record<string, unknown> };
}

/**
 * Estas pruebas **no** ejecutan SQL y por eso solo vigilan lo que se puede
 * afirmar sin una base de datos: que los valores del usuario viajen en
 * `replacements` y nunca concatenados en el texto, y que el feed siga siendo una
 * sola consulta.
 *
 * Lo que *significa* la consulta (aislamiento por gimnasio, caducidad,
 * restricción a matches, orden y desempate) se verifica ejecutándola de verdad
 * contra PostgreSQL en `stories.repository.integration.spec.ts`. Antes vivía
 * aquí como comparación de subcadenas, y eso resultó ser humo: borrar la clave
 * de desempate del `ORDER BY`, o quitar los paréntesis que agrupaban el filtro
 * de visibilidad —una fuga de stories entre gimnasios—, dejaba la suite entera
 * en verde. Un test que promete verificar el orden y no ejecuta ningún orden es
 * peor que no tenerlo.
 */
function createRepository() {
  const captured: CapturedQuery[] = [];
  const sequelize = {
    query: jest.fn((sql: string, options: CapturedQuery["options"]) => {
      captured.push({ sql, options });
      return Promise.resolve([]);
    }),
  } as unknown as Sequelize;

  const repository = new StoriesRepository(
    sequelize,
    {} as unknown as typeof StoryModel,
    {} as unknown as typeof StoryViewModel,
  );
  return { repository, captured };
}

describe("StoriesRepository.feedForConnections", () => {
  it("passes every user-supplied value through replacements, never inlined in the SQL", async () => {
    const { repository, captured } = createRepository();

    await repository.feedForConnections(viewerId, tenantId);

    const { sql, options } = captured[0];
    expect(options.type).toBe(QueryTypes.SELECT);
    expect(options.replacements).toEqual({
      viewerId,
      tenantId,
      acceptedStatus: ConnectionStatus.ACCEPTED,
      maxAuthors: STORY_FEED_MAX_AUTHORS,
      storiesPerAuthor: STORY_FEED_MAX_STORIES_PER_AUTHOR,
    });
    // Nada de valores de usuario incrustados en el texto de la consulta.
    expect(sql).not.toContain(viewerId);
    expect(sql).not.toContain(tenantId);
  });

  it("keeps the feed to a single query", async () => {
    const { repository, captured } = createRepository();

    await repository.feedForConnections(viewerId, tenantId);

    expect(captured).toHaveLength(1);
  });

  it("caps the feed instead of returning every active story of every match", () => {
    // El tope es contrato, no detalle: sin él la consulta devolvía 1200 filas de
    // golpe con 300 matches. Si alguien lo sube, que sea una decisión explícita.
    expect(STORY_FEED_MAX_AUTHORS).toBeLessThanOrEqual(50);
    expect(STORY_FEED_MAX_STORIES_PER_AUTHOR).toBeLessThanOrEqual(20);
  });
});

describe("StoriesRepository.viewersOf", () => {
  it("passes the story and tenant through replacements, never inlined in the SQL", async () => {
    const { repository, captured } = createRepository();

    await repository.viewersOf(storyId, tenantId);

    const { sql, options } = captured[0];
    expect(options.replacements).toEqual({
      storyId,
      tenantId,
      acceptedStatus: ConnectionStatus.ACCEPTED,
    });
    expect(sql).not.toContain(storyId);
    expect(sql).not.toContain(tenantId);
  });
});

describe("StoriesRepository.hasAcceptedConnection", () => {
  it("passes both ids through replacements, never inlined in the SQL", async () => {
    const { repository, captured } = createRepository();

    await repository.hasAcceptedConnection(viewerId, otherUserId);

    const { sql, options } = captured[0];
    expect(options.replacements).toEqual({
      userId: viewerId,
      otherUserId,
      acceptedStatus: ConnectionStatus.ACCEPTED,
    });
    expect(sql).not.toContain(viewerId);
    expect(sql).not.toContain(otherUserId);
  });

  it("answers false when the query returns no row", async () => {
    const { repository } = createRepository();
    await expect(repository.hasAcceptedConnection(viewerId, otherUserId)).resolves.toBe(false);
  });
});
