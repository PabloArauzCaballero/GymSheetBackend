import { PayloadTooLargeException } from '@nestjs/common';
import { EquipmentService } from '../equipment/equipment.service';
import { ProfilesService } from '../profiles/profiles.service';
import { UsersService } from '../users/users.service';
import { WorkoutSessionResponse } from '../workouts/workout.mapper';
import { WorkoutsService } from '../workouts/workouts.service';
import { ExportService } from './export.service';

const userId = '00000000-0000-4000-8000-000000000001';

function createSession(exerciseName: string): WorkoutSessionResponse {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    fechaInicio: new Date('2026-07-19T10:00:00.000Z'),
    estado: 'FINALIZADA',
    ejercicios: [
      {
        esEnfasis: true,
        ejercicio: { nombre: exerciseName },
        series: [
          {
            numeroSerie: 1,
            repeticiones: 8,
            pesoKg: 60,
            rir: 2,
            descansoSegAnterior: 120,
          },
        ],
      },
    ],
  } as unknown as WorkoutSessionResponse;
}

function createService(listMySessions: jest.Mock): ExportService {
  return new ExportService(
    { getActiveUserOrFail: jest.fn().mockResolvedValue({ id: userId, email: 'a@b.test', fullName: 'A' }) } as unknown as UsersService,
    { getMyProfile: jest.fn().mockResolvedValue({}) } as unknown as ProfilesService,
    { listAvailableEquipment: jest.fn().mockResolvedValue([]) } as unknown as EquipmentService,
    { listMySessions } as unknown as WorkoutsService,
  );
}

function singlePage(sessions: WorkoutSessionResponse[]): jest.Mock {
  return jest.fn().mockResolvedValue({ items: sessions, totalPages: 1, page: 1, pageSize: 100, total: sessions.length });
}

describe('ExportService CSV generation', () => {
  it.each([
    ['equals', '=cmd|calc'],
    ['plus', '+1+2'],
    ['minus', '-1+2'],
    ['at', '@SUM(A1:A9)'],
  ])('neutralises a spreadsheet formula beginning with %s', async (_label, hostileName) => {
    // A user-controlled exercise name reaching a spreadsheet must not be
    // evaluated as a formula when the exported file is opened.
    const service = createService(singlePage([createSession(hostileName)]));

    const csv = await service.buildWorkoutHistoryCsv(userId);

    expect(csv).toContain(`"'${hostileName}"`);
    expect(csv).not.toContain(`"${hostileName}"`);
  });

  it('applies both defences when a formula also contains quotes', async () => {
    const service = createService(
      singlePage([createSession('=HYPERLINK("http://evil.test","click")')]),
    );

    const csv = await service.buildWorkoutHistoryCsv(userId);

    // Prefixed so it is not evaluated, and inner quotes doubled so the cell
    // cannot terminate early.
    expect(csv).toContain('"\'=HYPERLINK(""http://evil.test"",""click"")"');
  });

  it('escapes embedded quotes so a cell cannot break out of its column', async () => {
    const service = createService(singlePage([createSession('Press "wide" grip')]));

    const csv = await service.buildWorkoutHistoryCsv(userId);

    expect(csv).toContain('"Press ""wide"" grip"');
  });

  it('keeps an ordinary exercise name unmodified', async () => {
    const service = createService(singlePage([createSession('Bench Press')]));

    const csv = await service.buildWorkoutHistoryCsv(userId);

    expect(csv).toContain('"Bench Press"');
  });

  it('emits a header row followed by one row per set', async () => {
    const service = createService(singlePage([createSession('Bench Press')]));

    const csv = await service.buildWorkoutHistoryCsv(userId);
    const lines = csv.trimEnd().split('\n');

    expect(lines[0]).toBe(
      'fecha_inicio,estado,ejercicio,serie,repeticiones,peso_kg,rir,descanso_seg_anterior,es_enfasis',
    );
    expect(lines).toHaveLength(2);
  });

  it('produces only the header when the user has no sessions', async () => {
    const service = createService(singlePage([]));

    const csv = await service.buildWorkoutHistoryCsv(userId);

    expect(csv.trimEnd().split('\n')).toHaveLength(1);
  });
});

describe('ExportService bounded reads', () => {
  it('stops paging once the last page is reached', async () => {
    const listMySessions = jest
      .fn()
      .mockResolvedValueOnce({ items: [createSession('A')], totalPages: 2, page: 1, pageSize: 100, total: 2 })
      .mockResolvedValueOnce({ items: [createSession('B')], totalPages: 2, page: 2, pageSize: 100, total: 2 });
    const service = createService(listMySessions);

    const result = await service.buildWorkoutHistoryExport(userId);

    expect(listMySessions).toHaveBeenCalledTimes(2);
    expect(result.sesiones).toHaveLength(2);
  });

  it('refuses an export that would exceed the synchronous size limit', async () => {
    // Guards against an unbounded in-memory payload: a user with a very long
    // history must get a controlled rejection rather than exhausting the heap.
    const fullPage = Array.from({ length: 100 }, () => createSession('Bench Press'));
    const service = createService(
      jest.fn().mockResolvedValue({ items: fullPage, totalPages: 999, page: 1, pageSize: 100, total: 99900 }),
    );

    await expect(service.buildWorkoutHistoryExport(userId)).rejects.toThrow(
      PayloadTooLargeException,
    );
  });
});
