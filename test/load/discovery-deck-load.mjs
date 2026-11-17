import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

/**
 * Load test of GET /me/discovery/deck (local ranking, franja 5) over 10,000
 * seeded members. Results: docs/performance/discovery-ranking.md.
 *
 * Usage (against a DISPOSABLE database the API is connected to):
 *   LOAD_SEED=1 BASE_URL=http://127.0.0.1:3000/api/v1 DB_NAME=gym_sheet_perf \
 *   DB_USER=postgres DB_PASSWORD=postgres node test/load/discovery-deck-load.mjs
 * The API must run with SIGNUP_TICKET_REQUIRED=false, SIGNUP_MIN_FILL_MS=0 and a
 * RATE_LIMIT_MAX above the request count. NEVER against a shared environment.
 */
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000/api/v1';
const viewers = Number(process.env.LOAD_VIEWERS ?? 10);
const totalRequests = Number(process.env.LOAD_DECK_REQUESTS ?? 400);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 10);
const budgetP95Ms = Number(process.env.BUDGET_DECK_P95_MS ?? 300);
const database = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
  return { data: payload?.data ?? payload, headers: response.headers };
}

async function createViewer(index, termsVersion) {
  const suffix = `${Date.now()}-${index}-${Math.floor(Math.random() * 1e6)}`;
  const registered = await call('/auth/register', {
    method: 'POST',
    body: {
      email: `load-deck-viewer-${suffix}@load.test`,
      password: 'load-strong-password',
      nombreCompleto: `Load Viewer ${index}`,
      acceptedTerms: true,
      genero: 'MALE',
      fechaNacimiento: '1994-03-10',
      termsVersion,
    },
  });
  const token = registered.data.accessToken;
  const userId = registered.data.user.id;
  await database.query(
    `UPDATE public.usuarios SET email_verified_at = now(),
            sede_id = '00000000-0000-4000-9000-000000000001' WHERE id = $1`,
    [userId],
  );
  await call('/me/social-discovery-settings', {
    token, method: 'PATCH', body: { profileEnabled: true, crossGymEnabled: false, mapEnabled: false, expectedVersion: 0 },
  });
  await call('/me/discovery/preferences', {
    token,
    method: 'PUT',
    body: {
      genders: ['FEMALE'], intents: ['TRAINING'], minAge: 18, maxAge: 60,
      radiusKm: 25, flexibleAge: false, flexibleDistance: false, expectedVersion: 0,
    },
  });
  return { token, cursor: null };
}

await database.connect();
if (process.env.LOAD_SEED === '1') {
  await database.query(await readFile(new URL('./discovery-deck-seed.sql', import.meta.url), 'utf8'));
}
const members = await database.query(`SELECT count(*)::int AS total FROM public.usuarios WHERE email LIKE 'load-ranking-%'`);
const legal = await call('/legal/current');
const termsVersion = legal.data.documents.find((entry) => entry.document === 'TERMS').version;
const accounts = [];
for (let index = 0; index < viewers; index += 1) accounts.push(await createViewer(index, termsVersion));

// Warm-up: caches, connection pool and query plans.
for (const account of accounts) await call('/me/discovery/deck?limit=10', { token: account.token });

const latencies = [];
const errors = [];
let cardsServed = 0;
let next = 0;
async function worker() {
  while (next < totalRequests) {
    const account = accounts[next % accounts.length];
    next += 1;
    // Alternate fresh decks and continuation pages, as a swiping client would.
    const query = account.cursor ? `limit=10&cursor=${encodeURIComponent(account.cursor)}` : 'limit=10';
    const started = performance.now();
    try {
      const page = await call(`/me/discovery/deck?${query}`, { token: account.token });
      cardsServed += page.data.length;
      account.cursor = account.cursor ? null : page.headers.get('x-next-cursor');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      latencies.push(performance.now() - started);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
await database.end();
latencies.sort((left, right) => left - right);
const result = {
  seededMembers: members.rows[0].total,
  viewers,
  requests: totalRequests,
  concurrency,
  cardsServed,
  errors: errors.slice(0, 5),
  p50Ms: Math.round(percentile(latencies, 50)),
  p95Ms: Math.round(percentile(latencies, 95)),
  p99Ms: Math.round(percentile(latencies, 99)),
  maxMs: Math.round(latencies.at(-1) ?? 0),
  budgetP95Ms,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) throw new Error(`${errors.length} deck requests failed`);
if (result.p95Ms > budgetP95Ms) throw new Error(`deck p95 ${result.p95Ms} ms exceeds ${budgetP95Ms} ms`);
