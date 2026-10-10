import { performance } from 'node:perf_hooks';

/**
 * Estrés de rutinas v2 (07_BACKOFFICE §5). Mide latencia del catálogo y comprueba
 * las garantías de concurrencia: una sola activación gana, una sola publicación
 * idéntica gana, y el límite de comentarios responde 429.
 *
 * Uso: BASE_URL=http://127.0.0.1:3000/api/v1 node test/load/routines-v2-load.mjs
 * NUNCA contra el TEST compartido sin coordinar con Atlas (R11).
 */
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000/api/v1';
const catalogRequests = Number(process.env.LOAD_CATALOG_REQUESTS ?? 200);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 20);
const budgets = {
  catalogP95Ms: Number(process.env.BUDGET_CATALOG_P95_MS ?? 400),
  catalogP99Ms: Number(process.env.BUDGET_CATALOG_P99_MS ?? 900),
};

const percentile = (sorted, p) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, data: payload?.data ?? payload, code: payload?.code };
}

async function register(label) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const res = await call('/auth/register', {
    method: 'POST',
    body: { email: `${label}-${suffix}@load.test`, password: 'load-strong-password', nombreCompleto: `Load ${label}`, acceptedTerms: true },
  });
  if (res.status !== 201) throw new Error(`register ${res.status}`);
  return res.data.accessToken;
}

async function pool(total, size, task) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < total) {
        const i = next++;
        results[i] = await task(i);
      }
    }),
  );
  return results;
}

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const token = await register('load-a');
const exercises = (await call(`/exercises?pageSize=6&page=${1 + Math.floor(Math.random() * 200)}`, { token })).data.items.map((e) => e.id);
const sets = 1 + Math.floor(Math.random() * 90);
const day = (ids) => [{ diaSemana: 1, ejercicios: ids.map((ejercicioId) => ({ ejercicioId, seriesObjetivo: sets, repsMin: 5, repsMax: 5 })) }];

// 1) Catálogo bajo carga.
const durations = [];
await pool(catalogRequests, concurrency, async () => {
  const t0 = performance.now();
  const r = await call('/routines?scope=public&limit=20&orden=populares', { token });
  durations.push(performance.now() - t0);
  return r.status;
});
durations.sort((a, b) => a - b);
const p95 = percentile(durations, 95);
const p99 = percentile(durations, 99);
check('catálogo p95', p95 <= budgets.catalogP95Ms, `${p95.toFixed(0)} ms ≤ ${budgets.catalogP95Ms}`);
check('catálogo p99', p99 <= budgets.catalogP99Ms, `${p99.toFixed(0)} ms ≤ ${budgets.catalogP99Ms}`);

// 2) Publicaciones idénticas simultáneas: gana una.
const ids = [exercises[0], exercises[1]];
const routineIds = [];
for (let i = 0; i < 10; i += 1) {
  const t = await register(`load-pub-${i}`);
  const created = await call('/routines', { token: t, method: 'POST', body: { nombre: `Carrera ${i}`, dias: day(ids) } });
  routineIds.push({ token: t, id: created.data.id });
}
const publishes = await Promise.all(routineIds.map((r) => call(`/routines/${r.id}/publish`, { token: r.token, method: 'POST' })));
const won = publishes.filter((p) => p.status === 201).length;
const dup = publishes.filter((p) => p.status === 409 && p.code === 'ROUTINE_DUPLICATE').length;
check('10 publicaciones idénticas: exactamente una gana', won === 1 && dup === 9, `ganadoras=${won}, duplicadas=${dup}`);

// 3) Activaciones simultáneas del mismo usuario: gana una.
const mine = [];
for (let i = 0; i < 5; i += 1) {
  const r = await call('/routines', { token, method: 'POST', body: { nombre: `Activar ${i}`, dias: day([exercises[2 + (i % 3)]]) } });
  if (r.status !== 201) console.log('crear rutina falló', r.status, JSON.stringify(r.data).slice(0, 200));
  mine.push(r.data?.id);
}
const activations = await Promise.all(mine.map((routineId) => call('/programs/strength/activate', { token, method: 'POST', body: { routineId, modo: 'NONE' } })));
const act201 = activations.filter((a) => a.status === 201).length;
const act409 = activations.filter((a) => a.status === 409 && a.code === 'PROGRAM_ACTIVE_CONFLICT').length;
check('5 activaciones simultáneas: exactamente una gana', act201 === 1 && act409 === 4, `201=${act201}, 409=${act409}, estados=${activations.map((a) => a.status).join(',')}`);

// 4) Ráfaga de comentarios: debe aparecer el límite.
const publicRoutine = routineIds.find((_, i) => publishes[i].status === 201);
const commenter = await register('load-commenter');
const comments = await pool(25, 1, () => call(`/comments/ROUTINE/${publicRoutine.id}`, { token: commenter, method: 'POST', body: { texto: 'ráfaga' } }));
check('límite de comentarios responde 429', comments.some((c) => c.status === 429), `ok=${comments.filter((c) => c.status === 201).length}`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} comprobaciones superadas`);
process.exit(failed.length === 0 ? 0 : 1);
