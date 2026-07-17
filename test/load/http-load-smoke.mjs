import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000/api/v1';
const applicationPid = Number(process.env.APP_PID ?? 0);
const readRequests = Number(process.env.LOAD_READ_REQUESTS ?? 60);
const exportRequests = Number(process.env.LOAD_EXPORT_REQUESTS ?? 15);
const writeRequests = Number(process.env.LOAD_WRITE_REQUESTS ?? 20);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 10);

const budgets = {
  readP95Ms: Number(process.env.BUDGET_READ_P95_MS ?? 800),
  readP99Ms: Number(process.env.BUDGET_READ_P99_MS ?? 1600),
  writeP95Ms: Number(process.env.BUDGET_WRITE_P95_MS ?? 1400),
  exportP95Ms: Number(process.env.BUDGET_EXPORT_P95_MS ?? 1400),
  rssGrowthBytes: Number(process.env.BUDGET_RSS_GROWTH_BYTES ?? 67108864),
};

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil((percentileValue / 100) * sortedValues.length) - 1,
  );
  return sortedValues[index];
}

async function readResidentMemoryBytes() {
  if (!applicationPid) return null;
  const status = await readFile(`/proc/${applicationPid}/status`, 'utf8');
  const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
  return match ? Number(match[1]) * 1024 : null;
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const responseText = await response.text();
  let payload = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = responseText;
    }
  }

  return { response, payload };
}

async function requestData(path, options = {}) {
  const { response, payload } = await request(path, options);
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`,
    );
  }
  return payload?.data ?? payload;
}

async function runBoundedRequests(totalRequests, task) {
  const latencies = [];
  const errors = [];
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= totalRequests) return;

      const startedAt = performance.now();
      try {
        await task(currentIndex);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        latencies.push(performance.now() - startedAt);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, totalRequests) }, worker));
  latencies.sort((left, right) => left - right);

  return {
    count: totalRequests,
    errors,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: latencies.at(-1) ?? 0,
  };
}

function assertBudget(condition, message) {
  if (!condition) throw new Error(message);
}

const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = 'LoadTestPassword123!';
const registration = await requestData('/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: `load-${uniqueSuffix}@example.test`,
    password,
    nombreCompleto: 'Load Test User',
  }),
});
const authorizationHeaders = {
  Authorization: `Bearer ${registration.accessToken}`,
  'Content-Type': 'application/json',
};
const exercise = await requestData('/exercises/personal', {
  method: 'POST',
  headers: authorizationHeaders,
  body: JSON.stringify({
    nombre: 'Load Test Press',
    grupoMuscular: 'Pectoral',
    descripcion: 'Synthetic record used only by the CI load smoke test.',
    equipoIds: [],
  }),
});
const workout = await requestData('/workouts', {
  method: 'POST',
  headers: authorizationHeaders,
  body: JSON.stringify({ observacion: 'CI load smoke session' }),
});
const sessionExercise = await requestData(`/workouts/${workout.id}/exercises`, {
  method: 'POST',
  headers: authorizationHeaders,
  body: JSON.stringify({
    ejercicioId: exercise.id,
    orden: 1,
    esEnfasis: true,
    nota: 'CI load smoke exercise',
  }),
});
await requestData(`/workouts/session-exercises/${sessionExercise.id}/sets`, {
  method: 'POST',
  headers: authorizationHeaders,
  body: JSON.stringify({
    numeroSerie: 1,
    repeticiones: 8,
    pesoKg: 60,
    rir: 2,
    descansoSegAnterior: 120,
  }),
});

const rssBefore = await readResidentMemoryBytes();
const readResult = await runBoundedRequests(readRequests, () =>
  requestData('/exercises?page=1&pageSize=25', { headers: authorizationHeaders }),
);
const writeResult = await runBoundedRequests(writeRequests, (requestIndex) =>
  requestData(`/workouts/session-exercises/${sessionExercise.id}/sets`, {
    method: 'POST',
    headers: authorizationHeaders,
    body: JSON.stringify({
      numeroSerie: requestIndex + 2,
      repeticiones: 8,
      pesoKg: 60,
      rir: 2,
      descansoSegAnterior: 120,
    }),
  }),
);
const exportResult = await runBoundedRequests(exportRequests, () =>
  requestData('/export/workout-history', { headers: authorizationHeaders }),
);
const rssAfter = await readResidentMemoryBytes();

const oversizedPayload = await request('/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }),
});
assertBudget(
  oversizedPayload.response.status === 413,
  `Expected oversized payload to return 413, received ${oversizedPayload.response.status}`,
);

let rateLimitObserved = false;
for (let attempt = 0; attempt < 12; attempt += 1) {
  const loginAttempt = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `missing-${uniqueSuffix}@example.test`,
      password,
    }),
  });
  if (loginAttempt.response.status === 429) {
    rateLimitObserved = true;
    break;
  }
}
assertBudget(rateLimitObserved, 'Authentication rate limit did not return HTTP 429.');

for (const [operation, result] of Object.entries({
  readExercises: readResult,
  createSets: writeResult,
  exportHistory: exportResult,
})) {
  assertBudget(result.errors.length === 0, `${operation} returned errors: ${result.errors.join('; ')}`);
}
assertBudget(
  readResult.p95Ms <= budgets.readP95Ms,
  `Read p95 ${readResult.p95Ms.toFixed(1)} ms exceeded ${budgets.readP95Ms} ms`,
);
assertBudget(
  readResult.p99Ms <= budgets.readP99Ms,
  `Read p99 ${readResult.p99Ms.toFixed(1)} ms exceeded ${budgets.readP99Ms} ms`,
);
assertBudget(
  writeResult.p95Ms <= budgets.writeP95Ms,
  `Write p95 ${writeResult.p95Ms.toFixed(1)} ms exceeded ${budgets.writeP95Ms} ms`,
);
assertBudget(
  exportResult.p95Ms <= budgets.exportP95Ms,
  `Export p95 ${exportResult.p95Ms.toFixed(1)} ms exceeded ${budgets.exportP95Ms} ms`,
);

const rssGrowthBytes =
  rssBefore === null || rssAfter === null ? null : Math.max(0, rssAfter - rssBefore);
if (rssGrowthBytes !== null) {
  assertBudget(
    rssGrowthBytes <= budgets.rssGrowthBytes,
    `RSS growth ${rssGrowthBytes} bytes exceeded ${budgets.rssGrowthBytes} bytes`,
  );
}

console.log(
  JSON.stringify(
    {
      budgets,
      results: {
        readExercises: readResult,
        createSets: writeResult,
        exportHistory: exportResult,
        rssBefore,
        rssAfter,
        rssGrowthBytes,
        oversizedPayloadStatus: oversizedPayload.response.status,
        authenticationRateLimitObserved: rateLimitObserved,
      },
    },
    null,
    2,
  ),
);
