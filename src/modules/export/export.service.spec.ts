import { PayloadTooLargeException } from '@nestjs/common';
import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { EquipmentService } from '../equipment/equipment.service';
import { ProfilesService } from '../profiles/profiles.service';
import { UsersService } from '../users/users.service';
import { WorkoutSessionResponse } from '../workouts/workout.mapper';
import { WorkoutsService } from '../workouts/workouts.service';
import type { Sequelize } from 'sequelize-typescript';
import { ExportService } from './export.service';

const userId = '00000000-0000-4000-8000-000000000001';
// El exportador recibe el principal entero, no solo su id: el catálogo de
// equipo que adjunta al informe se acota al gimnasio de quien lo pide.
const actor = {
  id: userId,
  email: 'socio@example.test',
  role: UserRole.CLIENT,
  tenantId: 'topfitness',
  tenantScope: 'topfitness',
  impersonating: false,
} as AuthenticatedUser;

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

    const csv = await service.buildWorkoutHistoryCsv(actor);

    expect(csv).toContain(`"'${hostileName}"`);
    expect(csv).not.toContain(`"${hostileName}"`);
  });

  it('applies both defences when a formula also contains quotes', async () => {
    const service = createService(
      singlePage([createSession('=HYPERLINK("http://evil.test","click")')]),
    );

    const csv = await service.buildWorkoutHistoryCsv(actor);

    // Prefixed so it is not evaluated, and inner quotes doubled so the cell
    // cannot terminate early.
    expect(csv).toContain('"\'=HYPERLINK(""http://evil.test"",""click"")"');
  });

  it('escapes embedded quotes so a cell cannot break out of its column', async () => {
    const service = createService(singlePage([createSession('Press "wide" grip')]));

    const csv = await service.buildWorkoutHistoryCsv(actor);

    expect(csv).toContain('"Press ""wide"" grip"');
  });

  it('keeps an ordinary exercise name unmodified', async () => {
    const service = createService(singlePage([createSession('Bench Press')]));

    const csv = await service.buildWorkoutHistoryCsv(actor);

    expect(csv).toContain('"Bench Press"');
  });

  it('emits a header row followed by one row per set', async () => {
    const service = createService(singlePage([createSession('Bench Press')]));

    const csv = await service.buildWorkoutHistoryCsv(actor);
    const lines = csv.trimEnd().split('\n');

    expect(lines[0]).toBe(
      'fecha_inicio,estado,ejercicio,serie,repeticiones,peso_kg,rir,descanso_seg_anterior,es_enfasis',
    );
    expect(lines).toHaveLength(2);
  });

  it('produces only the header when the user has no sessions', async () => {
    const service = createService(singlePage([]));

    const csv = await service.buildWorkoutHistoryCsv(actor);

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

    const result = await service.buildWorkoutHistoryExport(actor);

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

    await expect(service.buildWorkoutHistoryExport(actor)).rejects.toThrow(
      PayloadTooLargeException,
    );
  });
});

describe('ExportService PDF generation', () => {
  function countPages(pdf: Buffer): number {
    // Cada página es un objeto `/Type /Page`; `/Type /Pages` es el árbol que las agrupa.
    return (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;
  }

  it('does not append blank pages when drawing the footer', async () => {
    const service = createService(singlePage([createSession('Press banca')]));

    const pdf = await service.buildWorkoutHistoryPdf(actor);

    expect(countPages(pdf)).toBe(1);
  });
});

describe('ExportService Routine Progress Export and Audit', () => {
  const sampleRow = {
    usuario_id: userId,
    usuario_email: actor.email,
    usuario_nombre: 'Atleta Test',
    rutina_id: '11111111-1111-4000-8000-111111111111',
    rutina_nombre: 'Torso Pierna Fuerza',
    rutina_descripcion: 'Plan de 4 días',
    rutina_visibilidad: 'PUBLICA',
    rutina_objetivo: 'FUERZA',
    rutina_duracion_semanas: 8,
    rutina_version: 1,
    rutina_es_oficial: true,
    rutina_estado: 'ACTIVE',
    rutina_huella: 'abc123hash',
    rutina_publicada_en: new Date('2026-08-01T10:00:00Z'),
    rutina_creada_en: new Date('2026-07-01T10:00:00Z'),
    rutina_autor_id: userId,
    rutina_autor_nombre: 'Coach Carlos',
    rutina_autor_email: 'coach@example.test',
    rutina_atribucion_original: null,
    dia_id: '22222222-2222-4000-8000-222222222222',
    dia_nombre: 'Torso A',
    dia_semana_numero: 1,
    dia_semana_nombre: 'Lunes',
    dia_orden: 1,
    ejercicio_id: '33333333-3333-4000-8000-333333333333',
    ejercicio_nombre: 'Press Militar con Barra',
    ejercicio_grupo_muscular: 'Hombros',
    ejercicio_musculo_objetivo: 'Deltoides anterior',
    ejercicio_tipo: 'FUERZA',
    ejercicio_equipamiento: 'Barra olímpica',
    ejercicio_orden: 1,
    prescripcion_series: 4,
    prescripcion_reps_min: 6,
    prescripcion_reps_max: 8,
    prescripcion_reps_rango: '6 - 8',
    prescripcion_peso_objetivo_kg: 60,
    prescripcion_rir_objetivo: 2,
    prescripcion_descanso_seg: 180,
    prescripcion_nota: 'Pausa en pecho 1s',
    programa_id: '44444444-4444-4000-8000-444444444444',
    programa_carril: 'STRENGTH',
    programa_modo: 'PROGRESSIVE_OVERLOAD',
    programa_estado: 'ACTIVE',
    programa_multiplicador: 1.05,
    sobrecarga_peso_trabajo_kg: 62.5,
    sobrecarga_peso_sugerido_kg: 65,
    sobrecarga_e1rm_inicial_kg: 75,
    sobrecarga_e1rm_actual_kg: 80,
    sobrecarga_marca_meta_kg: 85,
    sobrecarga_fallos_seguidos: 0,
    sesion_id: '55555555-5555-4000-8000-555555555555',
    sesion_fecha_inicio: new Date('2026-09-01T15:00:00Z'),
    sesion_fecha_fin: new Date('2026-09-01T16:15:00Z'),
    sesion_duracion_min: 75,
    sesion_estado: 'FINALIZADA',
    sesion_observacion: 'Excelente sesión, buena velocidad',
    sesion_geo_verificada: true,
    sesion_ejercicio_es_enfasis: true,
    serie_id: '66666666-6666-4000-8000-666666666666',
    serie_numero: 1,
    serie_repeticiones_logradas: 8,
    serie_peso_levantado_kg: 62.5,
    serie_volumen_kg: 500,
    serie_rir_real: 2,
    serie_rpe_real: 8,
    serie_descanso_seg_previo: 180,
    serie_tipo: 'FUERZA',
    serie_cardio_duracion_seg: null,
    serie_cardio_distancia_m: null,
    serie_cardio_fc_media: null,
    serie_registrada_en: new Date('2026-09-01T15:10:00Z'),
  };

  it('builds CSV with UTF-8 BOM, correct headers and escaped values', async () => {
    const service = createService(jest.fn());
    jest.spyOn(service, 'fetchRoutineProgressRows').mockResolvedValue([sampleRow]);
    const auditSpy = jest.spyOn(service, 'recordRoutineProgressDownloadAudit').mockResolvedValue(undefined);

    const result = await service.buildRoutineProgressCsv(actor, {
      format: 'csv',
      routineId: 'ALL',
      datePreset: 'ALL',
      includeHistory: true,
      includeTargets: true,
      includePrograms: true,
    });

    expect(result.content.startsWith('\uFEFF')).toBe(true);
    expect(result.content).toContain('rutina_nombre');
    expect(result.content).toContain('Torso Pierna Fuerza');
    expect(result.content).toContain('Press Militar con Barra');
    expect(result.recordsCount).toBe(1);
    expect(auditSpy).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        format: 'CSV',
        recordsCount: 1,
      }),
    );
  });

  it('builds Excel (.xlsx) workbook with multiple sheets and styling', async () => {
    const service = createService(jest.fn());
    jest.spyOn(service, 'fetchRoutineProgressRows').mockResolvedValue([sampleRow]);
    const auditSpy = jest.spyOn(service, 'recordRoutineProgressDownloadAudit').mockResolvedValue(undefined);

    const result = await service.buildRoutineProgressExcel(actor, {
      format: 'excel',
      routineId: 'ALL',
      datePreset: 'ALL',
      includeHistory: true,
      includeTargets: true,
      includePrograms: true,
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(100);
    expect(result.fileName).toMatch(/\.xlsx$/);
    expect(result.recordsCount).toBe(1);
    expect(auditSpy).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        format: 'EXCEL',
        recordsCount: 1,
      }),
    );
  });

  it('builds PDF with GymSheet branding and KPI summary cards', async () => {
    const service = createService(jest.fn());
    jest.spyOn(service, 'fetchRoutineProgressRows').mockResolvedValue([sampleRow]);
    const auditSpy = jest.spyOn(service, 'recordRoutineProgressDownloadAudit').mockResolvedValue(undefined);

    const result = await service.buildRoutineProgressPdf(actor, {
      format: 'pdf',
      routineId: 'ALL',
      datePreset: 'ALL',
      includeHistory: true,
      includeTargets: true,
      includePrograms: true,
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(100);
    expect(result.fileName).toMatch(/\.pdf$/);
    expect(result.recordsCount).toBe(1);
    expect(auditSpy).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        format: 'PDF',
        recordsCount: 1,
      }),
    );
  });
});


describe('ExportService routine progress rows', () => {
  function serviceWithQuery(query: jest.Mock): ExportService {
    return new ExportService(
      {} as UsersService,
      {} as ProfilesService,
      {} as EquipmentService,
      {} as WorkoutsService,
      { query } as unknown as Sequelize,
    );
  }

  it('propaga un error de la consulta en vez de devolver un archivo vacío', async () => {
    const service = serviceWithQuery(jest.fn().mockRejectedValue(new Error('relation does not exist')));

    await expect(service.fetchRoutineProgressRows(actor as never, {} as never)).rejects.toThrow('relation does not exist');
  });

  it('pide filtrar cuando el progreso supera el tope síncrono de filas', async () => {
    const tooMany = Array.from({ length: 20001 }, () => ({}));
    const service = serviceWithQuery(jest.fn().mockResolvedValue(tooMany));

    await expect(service.fetchRoutineProgressRows(actor as never, {} as never)).rejects.toThrow(PayloadTooLargeException);
  });

  it('limita la consulta en SQL con una fila de margen', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await serviceWithQuery(query).fetchRoutineProgressRows(actor, {} as never);

    const [sql, options] = query.mock.calls[0] as [string, { replacements: Record<string, unknown> }];
    expect(sql).toContain('LIMIT :rowLimit');
    expect(options.replacements.rowLimit).toBe(20001);
  });
});
