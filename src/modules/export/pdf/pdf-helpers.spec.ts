import { Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { WorkoutSessionResponse } from '../../workouts/workout.mapper';
import type { RoutineProgressRow } from '../routine-progress.types';
import { registerPdfFonts } from './fonts';
import { formatKg, formatLongDate, formatMinutes, formatNumber, formatSignedKg } from './format';
import { describeRoutineProgressPeriod } from './period';
import { computeOverload, computeRoutineProgressStats } from './routine-progress.stats';
import { renderWorkoutHistoryPdf } from './workout-history.pdf';
import { PAGE, resolvePdfBrand } from './theme';
import { computeExerciseProgress, computeWorkoutHistoryStats, loadDelta } from './workout-history.stats';

const TZ = 'America/La_Paz';

function session(at: string, kg: number | null, estado = 'FINALIZADA', sets = 1): WorkoutSessionResponse {
  const start = new Date(at);
  return {
    id: `s-${at}-${kg}`,
    fechaInicio: start,
    fechaFin: new Date(start.getTime() + 50 * 60000),
    estado,
    ejercicios: [
      {
        orden: 1,
        ejercicio: { id: 'bench', nombre: 'Bench press', nombreEs: 'Press de banca' },
        series: Array.from({ length: sets }, (_, n) => ({ numeroSerie: n + 1, tipoSerie: 'FUERZA', repeticiones: 5, pesoKg: kg, rir: 2 })),
      },
    ],
  } as unknown as WorkoutSessionResponse;
}

type Drawn = { text: string; y: number | null };

/** Captura cada `doc.text` (con su y) mientras corre `run`. */
async function captureText<T>(run: () => Promise<T>): Promise<{ result: T; drawn: Drawn[] }> {
  const drawn: Drawn[] = [];
  const original = PDFDocument.prototype.text;
  const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: PDFKit.PDFDocument, ...args: any[]) {
    if (typeof args[0] === 'string') drawn.push({ text: args[0], y: typeof args[2] === 'number' ? args[2] : null });
    return (original as (...a: any[]) => PDFKit.PDFDocument).apply(this, args);
  });
  try {
    return { result: await run(), drawn };
  } finally {
    spy.mockRestore();
  }
}

const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

describe('PDF formatting', () => {
  it('groups thousands in Spanish even for four-digit numbers', () => {
    expect(formatNumber(4320)).toBe('4.320');
    expect(formatNumber(1234567.25, 1)).toBe('1.234.567,3');
    expect(formatKg(62.5)).toBe('62,5 kg');
    expect(formatSignedKg(-2.5)).toBe('-2,5 kg');
    expect(formatMinutes(125)).toBe('2 h 05 min');
  });

  it('writes instants in the business time zone', () => {
    // 01:30 UTC on the 20th is still Sunday the 19th in La Paz (UTC−4).
    expect(formatLongDate('2026-07-20T01:30:00Z', TZ)).toBe('Domingo, 19 de julio de 2026');
  });

  it('keeps date-only filters on their calendar day', () => {
    expect(describeRoutineProgressPeriod({ dateFrom: '2026-07-20', dateTo: '2026-07-31' }, TZ)).toBe('20 jul 2026 – 31 jul 2026');
    expect(describeRoutineProgressPeriod({ datePreset: 'LAST_30' }, TZ)).toBe('Últimos 30 días');
    expect(describeRoutineProgressPeriod({}, TZ)).toBe('Todo el historial');
  });

  it('falls back to REPP for unknown tenants without walking the prototype chain', () => {
    expect(resolvePdfBrand('constructor').name).toBe('REPP');
    expect(resolvePdfBrand('TOPFITNESS').name).toBe('TOP Fitness Center');
  });
});

describe('workout history stats', () => {
  it('derives totals, week streak and per-exercise progress from finished sessions only', () => {
    // Weeks of 5, 12 and 19 Jan are consecutive; 2 Feb breaks the run. In-progress and cancelled ones stay out.
    const sessions = [
      session('2026-01-05T14:00:00Z', 60),
      session('2026-01-12T14:00:00Z', 62.5),
      session('2026-01-19T14:00:00Z', 65),
      session('2026-02-02T14:00:00Z', 70),
      session('2026-01-20T14:00:00Z', 200, 'CANCELADA'),
      session('2026-02-03T14:00:00Z', 300, 'EN_PROGRESO'),
    ];

    const stats = computeWorkoutHistoryStats(sessions, TZ);
    const [bench] = computeExerciseProgress(sessions);

    expect(stats.finishedSessions).toBe(4);
    expect(stats.otherSessions).toBe(2);
    expect(stats.totalSets).toBe(4);
    expect(stats.totalVolumeKg).toBe(5 * (60 + 62.5 + 65 + 70));
    expect(stats.totalMinutes).toBe(200);
    expect(stats.longestWeekStreak).toBe(3);
    expect(bench).toMatchObject({ name: 'Press de banca', sessions: 4, firstTopKg: 60, lastTopKg: 70, bestSet: { kg: 70, reps: 5 } });
    expect(loadDelta(bench)).toBe(10);
  });

  it('buckets weeks in the business time zone', () => {
    // Sunday 19 Jul 21:30 in La Paz is 01:30Z on Monday: same local week as Monday 13 Jul.
    const sessions = [session('2026-07-13T15:00:00Z', 60), session('2026-07-20T01:30:00Z', 60)];

    expect(computeWorkoutHistoryStats(sessions, TZ).longestWeekStreak).toBe(1);
    expect(computeWorkoutHistoryStats(sessions, 'UTC').longestWeekStreak).toBe(2);
  });

  it('reports no load change for an exercise with fewer than two loaded sessions', () => {
    const [bench] = computeExerciseProgress([session('2026-01-05T14:00:00Z', 60), session('2026-01-12T14:00:00Z', null)]);

    expect(bench.sessions).toBe(2);
    expect(bench.loadedSessions).toBe(1);
    expect(loadDelta(bench)).toBeNull();
  });
});

describe('routine progress stats', () => {
  const row = (over: Partial<RoutineProgressRow>) => ({ rutina_id: 'r', rutina_nombre: 'Rutina', serie_id: 'x', ...over }) as RoutineProgressRow;

  it('averages time only over sessions with a known duration', () => {
    const stats = computeRoutineProgressStats([
      row({ sesion_id: 'a', sesion_duracion_min: 60, serie_id: '1' }),
      row({ sesion_id: 'b', sesion_duracion_min: null, serie_id: '2' }),
    ]);

    expect(stats.sessions).toBe(2);
    expect(stats.minutes).toBe(60);
    expect(stats.timedSessions).toBe(1);
  });

  it('keeps the same exercise in two programs apart, labelled by routine', () => {
    const base = { ejercicio_id: 'e', ejercicio_nombre: 'Sentadilla', sobrecarga_e1rm_inicial_kg: 100, sobrecarga_e1rm_actual_kg: 110 };
    const entries = computeOverload([
      row({ ...base, programa_id: 'p1', rutina_nombre: 'Fuerza' }),
      row({ ...base, programa_id: 'p2', rutina_nombre: 'Hipertrofia', programa_carril: 'STRENGTH' }),
    ]);

    expect(entries.map((e) => [e.routine, e.lane])).toEqual([
      ['Fuerza', null],
      ['Hipertrofia', 'STRENGTH'],
    ]);
  });
});

describe('PDF rendering limits', () => {
  it('falls back to Helvetica with a warning when a bundled font is corrupt', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const doc = new PDFDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    const garbage = Buffer.from('not a font');

    const fonts = registerPdfFonts(doc, { display: garbage, body: garbage, bold: garbage });
    doc.font(fonts.body).text('Hola');
    doc.end();

    expect(fonts).toEqual({ display: 'Helvetica-Bold', body: 'Helvetica', bold: 'Helvetica-Bold' });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'export.pdf_fonts_invalid' }));
    expect((await done).subarray(0, 5).toString()).toBe('%PDF-');
    warn.mockRestore();
  });

  it('renders the session date in the business time zone', async () => {
    const { drawn } = await captureText(() =>
      renderWorkoutHistoryPdf({ brand: resolvePdfBrand(null), athleteName: 'A', profile: null, sessions: [session('2026-07-20T01:30:00Z', 60)], timeZone: TZ }),
    );

    expect(drawn.map((d) => d.text)).toContain('Domingo, 19 de julio de 2026');
  });

  it('clamps a row taller than a page instead of drawing over the footer', async () => {
    const tall = session('2026-07-20T15:30:00Z', 102.5, 'FINALIZADA', 250);
    const { result: pdf, drawn } = await captureText(() =>
      renderWorkoutHistoryPdf({ brand: resolvePdfBrand(null), athleteName: 'A', profile: null, sessions: [tall], timeZone: TZ }),
    );
    const pageHeight = 841.89;
    const footerTop = pageHeight - 44;

    expect(pages(pdf)).toBeLessThanOrEqual(3);
    // Everything that is not the footer starts above the reserved footer band.
    const body = drawn.filter((d) => d.y !== null && d.y < footerTop);
    expect(body.every((d) => (d.y ?? 0) < pageHeight - PAGE.footerReserve)).toBe(true);
    expect(drawn.filter((d) => d.y !== null && d.y >= footerTop).every((d) => /^(REPP|Página \d+ de \d+)$/.test(d.text))).toBe(true);
  });

  it('caps the detail tables at the synchronous set budget and says so', async () => {
    const many = Array.from({ length: 400 }, (_, i) => session(new Date(Date.UTC(2025, 0, 1 + i, 15)).toISOString(), 60, 'FINALIZADA', 5));
    const { result: pdf, drawn } = await captureText(() =>
      renderWorkoutHistoryPdf({ brand: resolvePdfBrand(null), athleteName: 'A', profile: null, sessions: many, timeZone: TZ }),
    );

    expect(drawn.some((d) => d.text.startsWith('Este PDF muestra como mucho 1.500 series'))).toBe(true);
    // 300 of the 400 sessions are drawn; the summary still counts all 2.000 sets.
    expect(drawn.map((d) => d.text)).toContain('2.000');
    expect(pages(pdf)).toBeLessThan(80);
  });
});
