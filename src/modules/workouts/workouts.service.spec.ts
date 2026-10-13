import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Transaction, UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { WorkoutSessionStatus } from "../../common/enums/domain.enums";
import { ExercisesService } from "../exercises/exercises.service";
import { FacilitiesRepository } from "../facilities/facilities.repository";
import { ProgressionService } from "../progression/progression.service";
import { WorkoutSessionModel } from "./workout-session.model";
import { WorkoutSetModel } from "./workout-set.model";
import { CreateWorkoutSetInput } from "./workouts.schemas";
import { WorkoutsRepository } from "./workouts.repository";
import { WorkoutsService } from "./workouts.service";

const ownerId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const setId = "00000000-0000-4000-8000-000000000003";
const tenantId = "topfitness";

function createService(
  repositoryOverrides: Partial<WorkoutsRepository>,
  facilitiesOverrides: Partial<FacilitiesRepository> = {},
): WorkoutsService {
  return new WorkoutsService(
    repositoryOverrides as WorkoutsRepository,
    {} as ExercisesService,
    {
      findActiveBranchesWithCoordinates: jest.fn().mockResolvedValue([]),
      ...facilitiesOverrides,
    } as unknown as FacilitiesRepository,
    {} as Sequelize,
    {
      snapshot: jest
        .fn()
        .mockRejectedValue(new Error("sin senda en este test")),
    } as unknown as ProgressionService,
  );
}

function createSet(
  userId: string,
  status: WorkoutSessionStatus,
): WorkoutSetModel {
  return {
    id: setId,
    sessionExercise: {
      session: {
        userId,
        status,
      },
    },
  } as WorkoutSetModel;
}

describe("WorkoutsService ownership and state rules", () => {
  it("does not reveal a set owned by another user", async () => {
    const service = createService({
      findSetById: jest
        .fn()
        .mockResolvedValue(
          createSet(otherUserId, WorkoutSessionStatus.IN_PROGRESS),
        ),
    });

    await expect(service.deleteSet(ownerId, setId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("prevents mutation after a workout session is completed", async () => {
    const service = createService({
      findSetById: jest
        .fn()
        .mockResolvedValue(createSet(ownerId, WorkoutSessionStatus.COMPLETED)),
    });

    await expect(
      service.updateSet(ownerId, setId, { repetitions: 10 }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe("WorkoutsService planned session", () => {
  const planned = {
    id: "routine-1",
    name: "Fuerza",
    exercises: [
      {
        id: "second",
        exerciseId: "squat",
        order: 2,
        targetSets: 4,
        repsMin: 4,
        repsMax: 6,
        targetWeightKg: "80.00",
        targetRir: 2,
        restSeconds: 150,
        note: null,
      },
      {
        id: "first",
        exerciseId: "press",
        order: 1,
        targetSets: 3,
        repsMin: 6,
        repsMax: 8,
        targetWeightKg: null,
        targetRir: null,
        restSeconds: 90,
        note: "Controlar bajada",
      },
    ],
  };

  it("saves an ordered snapshot of the plan in one transaction", async () => {
    const transaction = {
      LOCK: { UPDATE: "UPDATE" },
    } as unknown as Transaction;
    const addExerciseToSession = jest.fn().mockResolvedValue({});
    const repository = {
      findOpenSessionForUser: jest.fn().mockResolvedValue(null),
      createSession: jest.fn().mockResolvedValue({ id: "session-1" }),
      addExerciseToSession,
    } as unknown as WorkoutsRepository;
    const service = new WorkoutsService(
      repository,
      {} as ExercisesService,
      {} as FacilitiesRepository,
      {
        transaction: <T>(fn: (tx: Transaction) => Promise<T>) =>
          fn(transaction),
      } as unknown as Sequelize,
      {} as ProgressionService,
    );
    jest
      .spyOn(service, "getMySession")
      .mockResolvedValue({ id: "session-1" } as never);

    await service.startPlannedSession(ownerId, planned);

    expect(addExerciseToSession).toHaveBeenNthCalledWith(
      1,
      "session-1",
      expect.objectContaining({
        exerciseId: "press",
        order: 1,
        plannedSets: 3,
        plannedRestSeconds: 90,
      }),
      transaction,
    );
    expect(addExerciseToSession).toHaveBeenNthCalledWith(
      2,
      "session-1",
      expect.objectContaining({
        exerciseId: "squat",
        order: 2,
        plannedWeightKg: 80,
        plannedRir: 2,
      }),
      transaction,
    );
  });

  it("resumes the matching open routine without creating another session", async () => {
    const createSession = jest.fn();
    const service = createService({
      findOpenSessionForUser: jest
        .fn()
        .mockResolvedValue({ id: "session-1", routineId: planned.id }),
      createSession,
    });
    jest
      .spyOn(service, "getMySession")
      .mockResolvedValue({ id: "session-1" } as never);

    expect((await service.startPlannedSession(ownerId, planned)).id).toBe(
      "session-1",
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it("keeps independently started invitation sessions under each participant account", async () => {
    const createSession = jest
      .fn()
      .mockResolvedValueOnce({ id: "session-a" })
      .mockResolvedValueOnce({ id: "session-b" });
    const repository = {
      findOpenSessionForUser: jest.fn().mockResolvedValue(null),
      createSession,
      addExerciseToSession: jest.fn().mockResolvedValue({}),
    } as unknown as WorkoutsRepository;
    const transaction = {} as Transaction;
    const service = new WorkoutsService(
      repository,
      {} as ExercisesService,
      {} as FacilitiesRepository,
      {
        transaction: <T>(fn: (tx: Transaction) => Promise<T>) =>
          fn(transaction),
      } as unknown as Sequelize,
      {} as ProgressionService,
    );
    jest
      .spyOn(service, "getMySession")
      .mockImplementation(async (_userId, id) => ({ id }) as never);

    const sessionA = await service.startPlannedSession(ownerId, planned);
    const sessionB = await service.startPlannedSession(otherUserId, planned);

    expect(sessionA.id).toBe("session-a");
    expect(sessionB.id).toBe("session-b");
    expect(createSession).toHaveBeenNthCalledWith(
      1,
      ownerId,
      { observation: "Plan: Fuerza" },
      transaction,
      planned.id,
    );
    expect(createSession).toHaveBeenNthCalledWith(
      2,
      otherUserId,
      { observation: "Plan: Fuerza" },
      transaction,
      planned.id,
    );
  });

  it("records each athlete’s actual set weight only against their own session exercise", async () => {
    const createSet = jest.fn(
      async (_exerciseId: string, input: CreateWorkoutSetInput) =>
        ({
          id: `set-${input.weightKg}`,
          setNumber: input.setNumber,
          repetitions: input.repetitions,
          weightKg: String(input.weightKg),
          rir: input.rir,
          previousRestSeconds: input.previousRestSeconds,
          recordedAt: new Date("2030-01-01T00:00:00Z"),
        }) as unknown as WorkoutSetModel,
    );
    const findSessionExerciseById = jest.fn(
      async (id: string) =>
        ({
          id,
          session: {
            userId: id === "exercise-a" ? ownerId : otherUserId,
            status: WorkoutSessionStatus.IN_PROGRESS,
          },
        }) as unknown as import("./workout-session-exercise.model").WorkoutSessionExerciseModel,
    );
    const service = createService({
      findSessionExerciseById,
      findSetBySessionExerciseAndNumber: jest.fn().mockResolvedValue(null),
      createSet,
    });
    (service as unknown as { sequelize: Sequelize }).sequelize = {
      transaction: <T>(fn: (tx: Transaction) => Promise<T>) =>
        fn({} as Transaction),
    } as unknown as Sequelize;

    const [setA, setB] = await Promise.all([
      service.addSet(ownerId, "exercise-a", {
        setNumber: 1,
        repetitions: 8,
        weightKg: 40,
        rir: 2,
        previousRestSeconds: 90,
      }),
      service.addSet(otherUserId, "exercise-b", {
        setNumber: 1,
        repetitions: 8,
        weightKg: 20,
        rir: 2,
        previousRestSeconds: 90,
      }),
    ]);

    expect([setA.pesoKg, setB.pesoKg]).toEqual([40, 20]);
    expect(createSet).toHaveBeenNthCalledWith(
      1,
      "exercise-a",
      expect.objectContaining({ weightKg: 40 }),
      expect.anything(),
    );
    expect(createSet).toHaveBeenNthCalledWith(
      2,
      "exercise-b",
      expect.objectContaining({ weightKg: 20 }),
      expect.anything(),
    );
  });
});

describe("WorkoutsService H10.S2.M4/M5", () => {
  it("awards progression only to the participant who completes their session", async () => {
    const before = { points: 100 } as never;
    const snapshot = jest.fn().mockResolvedValue(before);
    const recordSessionReward = jest
      .fn()
      .mockResolvedValue({ pointsEarned: 50 });
    const progression = {
      snapshot,
      recordSessionReward,
    } as unknown as ProgressionService;
    const service = new WorkoutsService(
      {
        findSessionByIdForUser: jest.fn().mockResolvedValue({
          id: "session-b",
          userId: otherUserId,
          status: WorkoutSessionStatus.IN_PROGRESS,
        }),
        changeSessionStatus: jest
          .fn()
          .mockImplementation((session: WorkoutSessionModel) => ({
            ...session,
            status: WorkoutSessionStatus.COMPLETED,
          })),
      } as unknown as WorkoutsRepository,
      {} as ExercisesService,
      {} as FacilitiesRepository,
      {} as Sequelize,
      progression,
    );

    await service.finishSession(otherUserId, tenantId, "session-b");

    expect(snapshot).toHaveBeenCalledWith(otherUserId);
    expect(recordSessionReward).toHaveBeenCalledWith(otherUserId, before);
    expect(snapshot).not.toHaveBeenCalledWith(ownerId);
  });

  it("retains a cancelled workout row and its owner in history", async () => {
    const session = {
      id: "session-a",
      userId: ownerId,
      status: WorkoutSessionStatus.IN_PROGRESS,
    };
    const changeSessionStatus = jest
      .fn()
      .mockImplementation(
        (row: WorkoutSessionModel, status: WorkoutSessionStatus) => ({
          ...row,
          status,
        }),
      );
    const service = createService({
      findSessionByIdForUser: jest.fn().mockResolvedValue(session),
      changeSessionStatus,
    });

    const result = await service.cancelSession(ownerId, "session-a");

    expect(result.id).toBe("session-a");
    expect(result.usuarioId).toBe(ownerId);
    expect(result.estado).toBe(WorkoutSessionStatus.CANCELLED);
    expect(changeSessionStatus).toHaveBeenCalledWith(
      session,
      WorkoutSessionStatus.CANCELLED,
    );
  });
});

describe("WorkoutsService.finishSession geo-verification", () => {
  function createInProgressSession(): WorkoutSessionModel {
    return {
      id: "session-1",
      userId: ownerId,
      status: WorkoutSessionStatus.IN_PROGRESS,
    } as WorkoutSessionModel;
  }

  it("finishes without verification when no location is sent", async () => {
    const changeSessionStatus = jest
      .fn()
      .mockImplementation(
        (
          session: WorkoutSessionModel,
          status: WorkoutSessionStatus,
          extra?: { geoVerified?: boolean; verifiedBranchId?: string | null },
        ) => ({
          ...session,
          status,
          ...extra,
        }),
      );
    const service = createService({
      findSessionByIdForUser: jest
        .fn()
        .mockResolvedValue(createInProgressSession()),
      changeSessionStatus,
    });

    await service.finishSession(ownerId, tenantId, "session-1");

    expect(changeSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      WorkoutSessionStatus.COMPLETED,
      { geoVerified: false, verifiedBranchId: null },
    );
  });

  it("only checks the branches of the gym the member belongs to", async () => {
    const findActiveBranchesWithCoordinates = jest.fn().mockResolvedValue([]);
    const service = createService(
      {
        findSessionByIdForUser: jest
          .fn()
          .mockResolvedValue(createInProgressSession()),
        changeSessionStatus: jest
          .fn()
          .mockImplementation((session: WorkoutSessionModel) => session),
      },
      { findActiveBranchesWithCoordinates },
    );

    await service.finishSession(ownerId, tenantId, "session-1", {
      latitude: 0,
      longitude: 0,
    });

    // Sin el gimnasio, la coordenada de una sede ajena daría por presencial una
    // sesión ocurrida en un gimnasio que no es el suyo.
    expect(findActiveBranchesWithCoordinates).toHaveBeenCalledWith(tenantId);
  });

  it("marks the session verified when the point falls inside a configured branch", async () => {
    const changeSessionStatus = jest
      .fn()
      .mockImplementation(
        (
          session: WorkoutSessionModel,
          status: WorkoutSessionStatus,
          extra?: { geoVerified?: boolean; verifiedBranchId?: string | null },
        ) => ({
          ...session,
          status,
          ...extra,
        }),
      );
    const service = createService(
      {
        findSessionByIdForUser: jest
          .fn()
          .mockResolvedValue(createInProgressSession()),
        changeSessionStatus,
      },
      {
        findActiveBranchesWithCoordinates: jest.fn().mockResolvedValue([
          {
            id: "branch-1",
            latitude: "0.000000",
            longitude: "0.000000",
            geofenceRadiusM: 200,
          },
        ]),
      },
    );

    await service.finishSession(ownerId, tenantId, "session-1", {
      latitude: 0.0001,
      longitude: 0,
    });

    expect(changeSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      WorkoutSessionStatus.COMPLETED,
      { geoVerified: true, verifiedBranchId: "branch-1" },
    );
  });

  it("finishes without verification when the point falls outside every branch radius", async () => {
    const changeSessionStatus = jest
      .fn()
      .mockImplementation(
        (
          session: WorkoutSessionModel,
          status: WorkoutSessionStatus,
          extra?: { geoVerified?: boolean; verifiedBranchId?: string | null },
        ) => ({
          ...session,
          status,
          ...extra,
        }),
      );
    const service = createService(
      {
        findSessionByIdForUser: jest
          .fn()
          .mockResolvedValue(createInProgressSession()),
        changeSessionStatus,
      },
      {
        findActiveBranchesWithCoordinates: jest.fn().mockResolvedValue([
          {
            id: "branch-1",
            latitude: "0.000000",
            longitude: "0.000000",
            geofenceRadiusM: 50,
          },
        ]),
      },
    );

    await service.finishSession(ownerId, tenantId, "session-1", {
      latitude: 5,
      longitude: 5,
    });

    expect(changeSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      WorkoutSessionStatus.COMPLETED,
      { geoVerified: false, verifiedBranchId: null },
    );
  });
});

describe("WorkoutsService concurrent session creation", () => {
  it("reports a conflict when the unique index rejects a racing second session", async () => {
    // Simulates the loser of a race: the pre-check saw no open session because
    // the winner had not committed yet, so the insert hits
    // `uq_active_workout_per_user`.
    const service = createService({
      findOpenSessionForUser: jest.fn().mockResolvedValue(null),
      createSession: jest.fn().mockRejectedValue(
        new UniqueConstraintError({
          errors: [],
          fields: { usuario_id: ownerId },
        }),
      ),
    });

    await expect(
      service.startSession(ownerId, { observation: null }),
    ).rejects.toThrow(ConflictException);
  });

  it("propagates unrelated repository failures instead of masking them as conflicts", async () => {
    const unexpectedFailure = new Error("connection terminated unexpectedly");
    const service = createService({
      findOpenSessionForUser: jest.fn().mockResolvedValue(null),
      createSession: jest.fn().mockRejectedValue(unexpectedFailure),
    });

    await expect(
      service.startSession(ownerId, { observation: null }),
    ).rejects.toThrow(unexpectedFailure);
  });
});
