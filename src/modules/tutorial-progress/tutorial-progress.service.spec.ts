import { TutorialProgressModel } from "./tutorial-progress.model";
import { TutorialProgressRepository, TutorialProgressValues } from "./tutorial-progress.repository";
import { tutorialIdParamSchema, tutorialProgressUpsertSchema } from "./tutorial-progress.schemas";
import { TutorialProgressService } from "./tutorial-progress.service";

const userId = "00000000-0000-4000-8000-00000000000a";
const otherUserId = "00000000-0000-4000-8000-00000000000b";
const now = new Date("2026-11-08T12:00:00.000Z");

function row(overrides: Partial<TutorialProgressModel> = {}): TutorialProgressModel {
  return {
    userId,
    tutorialId: "platform-intro",
    status: "IN_PROGRESS",
    version: "1.0.0",
    currentStepId: "paso-2",
    startedAt: new Date("2026-11-08T11:00:00.000Z"),
    completedAt: null,
    lastInteractionAt: new Date("2026-11-08T11:30:00.000Z"),
    repeatCount: 1,
    ...overrides,
  } as TutorialProgressModel;
}

/** Repositorio en memoria: una fila por (usuario, tutorial), igual que la clave primaria real. */
function memoryRepository(seed: TutorialProgressModel[] = []) {
  const store = new Map<string, TutorialProgressModel>();
  for (const item of seed) store.set(`${item.userId}|${item.tutorialId}`, item);
  const repository = {
    listByUser: jest.fn(async (id: string) => [...store.values()].filter((r) => r.userId === id)),
    findOne: jest.fn(async (id: string, tutorial: string) => store.get(`${id}|${tutorial}`) ?? null),
    upsert: jest.fn(
      async (id: string, tutorial: string, values: TutorialProgressValues, at: Date) => {
        const saved = { userId: id, tutorialId: tutorial, ...values, lastInteractionAt: at } as TutorialProgressModel;
        store.set(`${id}|${tutorial}`, saved);
        return saved;
      },
    ),
    remove: jest.fn(async (id: string, tutorial: string) => {
      store.delete(`${id}|${tutorial}`);
    }),
  };
  return { repository, service: new TutorialProgressService(repository as unknown as TutorialProgressRepository) };
}

describe("TutorialProgressService", () => {
  it("devuelve solo el progreso del usuario del token", async () => {
    const { service } = memoryRepository([row(), row({ userId: otherUserId, tutorialId: "ajeno" })]);
    const list = await service.list(userId);
    expect(list.map((r) => r.tutorialId)).toEqual(["platform-intro"]);
  });

  it("serializa fechas en ISO y nulos como null", async () => {
    const { service } = memoryRepository([row()]);
    const [record] = await service.list(userId);
    expect(record).toEqual({
      tutorialId: "platform-intro",
      status: "IN_PROGRESS",
      version: "1.0.0",
      currentStepId: "paso-2",
      startedAt: "2026-11-08T11:00:00.000Z",
      completedAt: null,
      lastInteractionAt: "2026-11-08T11:30:00.000Z",
      repeatCount: 1,
    });
  });

  it("crea el registro en el primer PUT y lo deja idéntico si se repite (idempotente)", async () => {
    const { service } = memoryRepository();
    const body = { status: "IN_PROGRESS" as const, version: "1.0.0", currentStepId: "paso-1" };
    const first = await service.upsert(userId, "platform-intro", body, now);
    const second = await service.upsert(userId, "platform-intro", body, now);
    expect(second).toEqual(first);
    expect((await service.list(userId)).length).toBe(1);
  });

  it("un campo ausente conserva lo guardado", async () => {
    const { service } = memoryRepository([row()]);
    const out = await service.upsert(userId, "platform-intro", { status: "COMPLETED", version: "1.0.0" }, now);
    expect(out.status).toBe("COMPLETED");
    expect(out.currentStepId).toBe("paso-2");
    expect(out.startedAt).toBe("2026-11-08T11:00:00.000Z");
    expect(out.repeatCount).toBe(1);
  });

  it("null borra el campo y una fecha ISO se guarda", async () => {
    const { service } = memoryRepository([row()]);
    const out = await service.upsert(
      userId,
      "platform-intro",
      { status: "COMPLETED", version: "1.1.0", currentStepId: null, completedAt: "2026-11-08T12:00:00.000Z", repeatCount: 2 },
      now,
    );
    expect(out.currentStepId).toBeNull();
    expect(out.completedAt).toBe("2026-11-08T12:00:00.000Z");
    expect(out.version).toBe("1.1.0");
    expect(out.repeatCount).toBe(2);
  });

  it("escribir como un usuario no toca el progreso de otro", async () => {
    const { service, repository } = memoryRepository([row({ userId: otherUserId })]);
    await service.upsert(userId, "platform-intro", { status: "SKIPPED", version: "1.0.0" }, now);
    expect(repository.findOne).toHaveBeenCalledWith(userId, "platform-intro");
    const theirs = await service.list(otherUserId);
    expect(theirs[0].status).toBe("IN_PROGRESS");
  });

  it("reset borra solo ese tutorial y devuelve la lista restante", async () => {
    const { service } = memoryRepository([row(), row({ tutorialId: "otro" })]);
    const remaining = await service.reset(userId, "platform-intro");
    expect(remaining.map((r) => r.tutorialId)).toEqual(["otro"]);
  });
});

describe("esquemas de tutorial-progress", () => {
  it("acepta el cuerpo mínimo que manda la web", () => {
    expect(tutorialProgressUpsertSchema.safeParse({ status: "IN_PROGRESS", version: "1.0.0" }).success).toBe(true);
  });

  it("rechaza estados desconocidos, fechas mal formadas y repeatCount negativo", () => {
    expect(tutorialProgressUpsertSchema.safeParse({ status: "HECHO", version: "1" }).success).toBe(false);
    expect(
      tutorialProgressUpsertSchema.safeParse({ status: "COMPLETED", version: "1", completedAt: "ayer" }).success,
    ).toBe(false);
    expect(
      tutorialProgressUpsertSchema.safeParse({ status: "COMPLETED", version: "1", repeatCount: -1 }).success,
    ).toBe(false);
  });

  it("valida el id del tutorial y descarta rutas raras", () => {
    expect(tutorialIdParamSchema.safeParse("platform-intro").success).toBe(true);
    expect(tutorialIdParamSchema.safeParse("a/b").success).toBe(false);
    expect(tutorialIdParamSchema.safeParse("../x").success).toBe(false);
    expect(tutorialIdParamSchema.safeParse("x".repeat(101)).success).toBe(false);
  });
});
