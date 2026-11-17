-- Synthetic volume for the "Conocer" deck load test and EXPLAIN evidence
-- (docs/performance/discovery-ranking.md). NEVER run against a shared database.
--
-- 10,000 members of tenant `default` around Santa Cruz (5 branches, ~1–12 km
-- apart), half FEMALE / half MALE, ages 20–49, two photos each, discovery on,
-- preferences for the opposite sex, activity spread over 60 days, plus 40,000
-- passes and 20,000 likes so the mutual-likelihood counts have work to do.
-- Idempotent: rows are keyed by `load-ranking-*` emails and deterministic ids.
BEGIN;

INSERT INTO facilities.branches (id, code, name, time_zone, latitude, longitude, tenant_id)
SELECT ('00000000-0000-4000-9000-' || lpad(b::text, 12, '0'))::uuid, 'load-rank-' || b, 'Load branch ' || b,
       'America/La_Paz', -17.78 + b * 0.02, -63.18 + b * 0.01, 'default'
  FROM generate_series(1, 5) AS b
ON CONFLICT DO NOTHING;

INSERT INTO public.usuarios
  (id, email, password_hash, nombre_completo, genero, fecha_nacimiento, sede_id, tenant_id,
   email_verified_at, verified_at, created_at, last_active_at, active_hours)
SELECT ('00000000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid,
       'load-ranking-' || n || '@load.test', 'not-a-login', 'Load Member ' || n,
       CASE WHEN n % 2 = 0 THEN 'FEMALE' ELSE 'MALE' END,
       (current_date - make_interval(years => 20 + n % 30, days => n % 300))::date,
       ('00000000-0000-4000-9000-' || lpad((1 + n % 5)::text, 12, '0'))::uuid, 'default',
       now() - interval '30 days',
       CASE WHEN n % 7 = 0 THEN now() - interval '10 days' END,
       now() - make_interval(days => n % 400),
       now() - make_interval(mins => (n * 37) % (60 * 24 * 60)),
       ARRAY(SELECT CASE WHEN (n + h) % 4 = 0 THEN current_date - (n % 20) END FROM generate_series(0, 23) h)
  FROM generate_series(1, 10000) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO social.profile_settings (user_id, profile_enabled, social_status)
SELECT ('00000000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid, true,
       (ARRAY['SINGLE', 'OPEN_TO_MEET', 'IN_RELATIONSHIP'])[1 + n % 3]
  FROM generate_series(1, 10000) AS n
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO social.discovery_preferences
  (user_id, genders, intents, min_age, max_age, radius_km, flexible_age, flexible_distance)
SELECT ('00000000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid,
       CASE WHEN n % 2 = 0 THEN ARRAY['MALE'] ELSE ARRAY['FEMALE'] END,
       CASE n % 4 WHEN 0 THEN ARRAY['TRAINING'] WHEN 1 THEN ARRAY['TRAINING', 'FRIENDSHIP']
                  WHEN 2 THEN ARRAY['DATING'] ELSE ARRAY['UNSURE'] END,
       18, 60, 25, n % 3 = 0, n % 5 = 0
  FROM generate_series(1, 10000) AS n
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO social.profile_details (user_id, interests)
SELECT ('00000000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid,
       CASE n % 4 WHEN 0 THEN ARRAY['RUNNING', 'YOGA'] WHEN 1 THEN ARRAY['CROSSFIT']
                  WHEN 2 THEN ARRAY['MUSIC', 'TRAVEL', 'RUNNING'] ELSE ARRAY[]::text[] END
  FROM generate_series(1, 10000) AS n
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.perfiles_antropometricos (usuario_id, peso_kg, estatura_cm, objetivo)
SELECT ('00000000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid, 70, 170,
       (ARRAY['HIPERTROFIA', 'FUERZA', 'RESISTENCIA', 'PERDIDA_GRASA'])[1 + n % 4]
  FROM generate_series(1, 10000) AS n
ON CONFLICT (usuario_id) DO NOTHING;

INSERT INTO profile.photos (user_id, url, storage_provider, storage_key, position)
SELECT ('00000000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid, 'http://localhost/load.jpg', 'local',
       'load-ranking/' || n || '/' || p, p
  FROM generate_series(1, 10000) AS n, generate_series(0, 1) AS p
 WHERE NOT EXISTS (SELECT 1 FROM profile.photos ph WHERE ph.storage_key = 'load-ranking/' || n || '/' || p);

-- Decisions between seeded members (opposite sex pairs, deterministic).
INSERT INTO social.discovery_passes (viewer_id, target_id, created_at)
SELECT ('00000000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-4000-a000-' || lpad((1 + (n + 2 * k) % 10000)::text, 12, '0'))::uuid,
       now() - make_interval(days => k)
  FROM generate_series(1, 10000) AS n, generate_series(1, 4) AS k
ON CONFLICT DO NOTHING;

INSERT INTO social.connections (requester_id, addressee_id, status, created_at)
SELECT ('00000000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-4000-a000-' || lpad((1 + (n + 2 * k + 10) % 10000)::text, 12, '0'))::uuid,
       CASE WHEN k = 1 THEN 'ACCEPTED' ELSE 'PENDING' END, now() - make_interval(days => k)
  FROM generate_series(1, 10000) AS n, generate_series(1, 2) AS k
ON CONFLICT DO NOTHING;

-- Some members are training right now.
INSERT INTO public.sesiones_entrenamiento (usuario_id, fecha_inicio)
SELECT ('00000000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid, now() - interval '30 minutes'
  FROM generate_series(1, 10000, 50) AS n
ON CONFLICT DO NOTHING;

COMMIT;
ANALYZE public.usuarios;
ANALYZE social.profile_settings;
ANALYZE social.discovery_preferences;
ANALYZE social.connections;
ANALYZE social.discovery_passes;
ANALYZE profile.photos;
