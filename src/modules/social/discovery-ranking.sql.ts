/**
 * One statement ranks the local "Conocer" deck.
 *
 * 1. `pool`: a bounded candidate pool read in index order — the 300 most
 *    recently active verified members of the gym (`ix_usuarios_discovery_active`),
 *    the newest 60 (`ix_usuarios_discovery_new`, exploration), cross-gym members
 *    who opted in (`ix_profile_settings_cross_gym`) and whoever already liked
 *    the viewer (`ix_connections_addressee`).
 * 2. `cand`: hard filters — adult, verified email, 2+ visible photos, profile
 *    enabled, two-sided preferences (each side's genders and age range include
 *    the other; `flexible_age` widens a range by 2 years), not blocked, not
 *    decided, tenant or bilateral cross-gym consent.
 * 3. `feat` / `scored`: radius filter (1.5× with `flexibleDistance`) and the
 *    seven factors, combined with the weights of the assigned config version.
 * 4. Keyset `(score, id)` inside a snapshot (`:asOf` freezes every clock read).
 *    `feat` and `scored` are MATERIALIZED so each per-candidate subquery runs
 *    once (inlined, the planner evaluated factors again for the sort key).
 *
 * Location: the viewer's own map location (fresh < 24 h) or their branch; a
 * candidate's map location only as the centre of its public ~2 km cell, never
 * the stored coordinate. Sexual orientation is never read (asserted by a test).
 */
export const DISCOVERY_RANKING_SQL = `
WITH p AS (
  SELECT CAST(:asOf AS timestamptz) AS as_of,
         ((CAST(:asOf AS timestamptz) AT TIME ZONE :timeZone)::date - 14) AS hours_cutoff
),
viewer AS (
  SELECT u.id, u.genero AS gender, va.age, pa.objetivo AS goal,
         ob.weekly_frequency AS frequency, u.sede_id AS branch_id,
         COALESCE(pd.interests, '{}'::text[]) AS interests, u.active_hours,
         CASE WHEN ml.user_id IS NOT NULL THEN ml.latitude::float8 ELSE br.latitude::float8 END AS lat,
         CASE WHEN ml.user_id IS NOT NULL THEN ml.longitude::float8 ELSE br.longitude::float8 END AS lon,
         ARRAY(SELECT tp.routine_id FROM training.training_programs tp
                WHERE tp.usuario_id = u.id AND tp.estado = 'ACTIVE' AND tp.routine_id IS NOT NULL
               UNION
               SELECT ra.routine_id FROM training.routine_assignments ra
                WHERE ra.cliente_user_id = u.id AND ra.estado = 'ACTIVE') AS routines
    FROM p
    JOIN public.usuarios u ON u.id = :viewerId
    CROSS JOIN LATERAL (SELECT EXTRACT(YEAR FROM age(p.as_of::date, u.fecha_nacimiento))::int AS age) va
    LEFT JOIN public.perfiles_antropometricos pa ON pa.usuario_id = u.id
    LEFT JOIN profile.onboarding ob ON ob.user_id = u.id
    LEFT JOIN social.profile_details pd ON pd.user_id = u.id
    LEFT JOIN social.profile_settings vs ON vs.user_id = u.id
    LEFT JOIN social.map_locations ml
      ON ml.user_id = u.id AND vs.map_enabled AND ml.updated_at >= p.as_of - INTERVAL '24 hours'
    LEFT JOIN facilities.branches br ON br.id = u.sede_id AND br.status = 'ACTIVE'
),
pool AS (
  SELECT DISTINCT sources.id FROM (
    (SELECT u.id FROM public.usuarios u
      WHERE u.tenant_id = :tenantId AND u.estado = 'ACTIVO' AND u.email_verified_at IS NOT NULL
        AND u.genero IN (:genders)
      ORDER BY u.last_active_at DESC NULLS LAST, u.id LIMIT :poolLimit)
    UNION ALL
    (SELECT u.id FROM public.usuarios u, p
      WHERE u.tenant_id = :tenantId AND u.estado = 'ACTIVO' AND u.email_verified_at IS NOT NULL
        AND u.genero IN (:genders) AND u.created_at >= p.as_of - INTERVAL '7 days'
      ORDER BY u.created_at DESC LIMIT 60)
    UNION ALL
    (SELECT u.id FROM social.profile_settings cs JOIN public.usuarios u ON u.id = cs.user_id
      WHERE :includeCrossGym AND cs.profile_enabled AND cs.cross_gym_enabled
        AND u.tenant_id <> :tenantId AND u.estado = 'ACTIVO' AND u.email_verified_at IS NOT NULL
        AND u.genero IN (:genders)
      ORDER BY u.last_active_at DESC NULLS LAST, u.id LIMIT :poolLimit)
    UNION ALL
    (SELECT c.requester_id FROM social.connections c
      WHERE c.addressee_id = :viewerId AND c.status = 'PENDING'
      ORDER BY c.created_at DESC LIMIT 100)
  ) sources
),
cand AS (
  SELECT u.id, u.created_at, u.verified_at, u.sede_id, u.active_hours, ca.age,
         LEAST(GREATEST(u.last_active_at, u.last_seen_at), p.as_of) AS seen_at,
         pa.objetivo AS goal, ob.weekly_frequency AS frequency,
         COALESCE(pd.interests, '{}'::text[]) AS interests, s.social_status,
         cp.intents, cp.min_age AS their_min_age, cp.max_age AS their_max_age,
         (liked.id IS NOT NULL) AS liked_viewer, dist.distance_km
    FROM pool
    JOIN public.usuarios u ON u.id = pool.id
    JOIN social.profile_settings s ON s.user_id = u.id AND s.profile_enabled
    JOIN social.discovery_preferences cp ON cp.user_id = u.id
    CROSS JOIN p
    CROSS JOIN viewer v
    CROSS JOIN LATERAL (SELECT EXTRACT(YEAR FROM age(p.as_of::date, u.fecha_nacimiento))::int AS age) ca
    LEFT JOIN public.perfiles_antropometricos pa ON pa.usuario_id = u.id
    LEFT JOIN profile.onboarding ob ON ob.user_id = u.id
    LEFT JOIN social.profile_details pd ON pd.user_id = u.id
    LEFT JOIN social.map_locations ml
      ON ml.user_id = u.id AND s.map_enabled AND ml.updated_at >= p.as_of - INTERVAL '24 hours'
    LEFT JOIN LATERAL (
      SELECT cell_lat.lat,
             -180 + (split_part(ml.cell_id, ':', 2)::int + 0.5)
               * (2000 / (111320 * GREATEST(cos(radians(cell_lat.lat)), 0.087))) AS lon
        FROM (SELECT (-90 + (split_part(ml.cell_id, ':', 1)::int + 0.5) * (2000 / 111320.0))::float8 AS lat) cell_lat
    ) cell ON ml.user_id IS NOT NULL
    LEFT JOIN facilities.branches br ON br.id = u.sede_id AND br.status = 'ACTIVE'
    CROSS JOIN LATERAL (
      SELECT CASE WHEN ml.user_id IS NOT NULL THEN cell.lat ELSE br.latitude::float8 END AS lat,
             CASE WHEN ml.user_id IS NOT NULL THEN cell.lon ELSE br.longitude::float8 END AS lon
    ) loc
    -- Haversine; filtered here so no feature is computed for someone out of range.
    CROSS JOIN LATERAL (
      SELECT CASE WHEN v.lat IS NULL OR loc.lat IS NULL THEN NULL
                  ELSE 2 * 6371 * asin(sqrt(
                    power(sin(radians(loc.lat - v.lat) / 2), 2)
                    + cos(radians(v.lat)) * cos(radians(loc.lat)) * power(sin(radians(loc.lon - v.lon) / 2), 2)))
             END AS distance_km
    ) dist
    LEFT JOIN social.connections liked
      ON liked.requester_id = u.id AND liked.addressee_id = :viewerId AND liked.status = 'PENDING'
   WHERE u.id <> :viewerId
     AND (v.lat IS NULL
          OR dist.distance_km <= :radiusKm * CASE WHEN :flexibleDistance THEN 1.5 ELSE 1 END)
     AND u.estado = 'ACTIVO' AND u.email_verified_at IS NOT NULL
     AND (u.suspended_until IS NULL OR u.suspended_until <= p.as_of)
     AND u.genero IN (:genders)
     AND (u.tenant_id = :tenantId OR (:includeCrossGym AND s.cross_gym_enabled))
     AND ca.age >= 18
     AND ca.age BETWEEN :minAge - CASE WHEN :flexibleAge THEN 2 ELSE 0 END
                    AND :maxAge + CASE WHEN :flexibleAge THEN 2 ELSE 0 END
     AND v.gender = ANY(cp.genders)
     AND v.age BETWEEN cp.min_age - CASE WHEN cp.flexible_age THEN 2 ELSE 0 END
                   AND cp.max_age + CASE WHEN cp.flexible_age THEN 2 ELSE 0 END
     AND (:objetivo::text IS NULL OR pa.objetivo = ANY(string_to_array(:objetivo, ',')))
     AND (:branchId::uuid IS NULL OR u.sede_id = :branchId)
     AND (:gender::text IS NULL OR u.genero = :gender)
     AND (:search::text IS NULL OR u.nombre_completo ILIKE :search)
     AND NOT EXISTS (
       SELECT 1 FROM social.user_blocks b
        WHERE (b.blocker_id = :viewerId AND b.blocked_id = u.id)
           OR (b.blocker_id = u.id AND b.blocked_id = :viewerId))
     -- Decided: any connection, except a pending like the candidate sent.
     AND NOT EXISTS (
       SELECT 1 FROM social.connections dc
        WHERE ((dc.requester_id = :viewerId AND dc.addressee_id = u.id)
            OR (dc.requester_id = u.id AND dc.addressee_id = :viewerId AND dc.status <> 'PENDING')))
     AND NOT EXISTS (
       SELECT 1 FROM social.discovery_passes dp WHERE dp.viewer_id = :viewerId AND dp.target_id = u.id)
     AND (SELECT count(*) FROM (
            SELECT 1 FROM profile.photos ph WHERE ph.user_id = u.id AND ph.hidden_at IS NULL LIMIT 2) two) = 2
),
feat AS MATERIALIZED (
  SELECT c.*,
         (EXISTS (SELECT 1 FROM public.sesiones_entrenamiento se
                   WHERE se.usuario_id = c.id AND se.estado = 'EN_PROGRESO'
                     AND se.fecha_inicio BETWEEN p.as_of - INTERVAL '3 hours' AND p.as_of)
          OR EXISTS (SELECT 1 FROM access_control.decisions ad
                      WHERE ad.user_id = c.id AND ad.outcome = 'GRANTED'
                        AND ad.decided_at BETWEEN p.as_of - INTERVAL '3 hours' AND p.as_of)) AS training_now,
         EXTRACT(EPOCH FROM (p.as_of - c.seen_at)) / 3600 AS hours_seen,
         EXTRACT(EPOCH FROM (p.as_of - c.created_at)) / 3600 AS hours_since_signup,
         COALESCE((SELECT count(*) FILTER (WHERE h.mine >= p.hours_cutoff AND h.theirs >= p.hours_cutoff)::float8
                          / NULLIF(count(*) FILTER (WHERE h.mine >= p.hours_cutoff OR h.theirs >= p.hours_cutoff), 0)
                     FROM unnest(v.active_hours, c.active_hours) AS h(mine, theirs)), 0) AS hour_overlap,
         (SELECT count(*) FROM social.connections lc
           WHERE lc.requester_id = c.id AND lc.created_at BETWEEN p.as_of - INTERVAL '90 days' AND p.as_of) AS likes_given,
         (SELECT count(*) FROM social.discovery_passes lp
           WHERE lp.viewer_id = c.id AND lp.created_at BETWEEN p.as_of - INTERVAL '90 days' AND p.as_of) AS passes_given,
         ARRAY(SELECT tp.routine_id FROM training.training_programs tp
                WHERE tp.usuario_id = c.id AND tp.estado = 'ACTIVE' AND tp.routine_id IS NOT NULL
               UNION
               SELECT ra.routine_id FROM training.routine_assignments ra
                WHERE ra.cliente_user_id = c.id AND ra.estado = 'ACTIVE') AS routines,
         (SELECT count(*) FROM unnest(c.intents) i WHERE i = ANY(ARRAY[:intents]::text[])) AS shared_intents,
         (SELECT count(*) FROM unnest(c.interests) i WHERE i = ANY(v.interests)) AS shared_interests,
         GREATEST(:minAge - c.age, c.age - :maxAge, 0)
           + GREATEST(c.their_min_age - v.age, v.age - c.their_max_age, 0) AS years_outside
    FROM cand c CROSS JOIN viewer v CROSS JOIN p
),
scored AS MATERIALIZED (
  SELECT f.id, f.liked_viewer, (f.hours_since_signup < 168) AS is_new,
         CASE WHEN f.distance_km IS NULL THEN NULL ELSE GREATEST(1, round(f.distance_km))::int END AS distance_km,
         x.activity, x.mutual, x.distance, x.intent, x.affinity, x.verification, x.novelty,
         round((:wActivity * x.activity + :wMutual * x.mutual + :wDistance * x.distance
                + :wIntent * x.intent + :wAffinity * x.affinity + :wVerification * x.verification
                + :wNovelty * x.novelty - 0.05 * f.years_outside)::numeric, 6) AS score,
         array_remove(ARRAY[
           CASE WHEN f.distance_km IS NOT NULL AND f.distance_km <= 5 THEN 'NEARBY' END,
           CASE WHEN f.training_now THEN 'TRAINING_NOW' END,
           CASE WHEN NOT f.training_now AND f.hours_seen <= 0.25 THEN 'ACTIVE_NOW' END,
           CASE WHEN v.goal = f.goal THEN 'SAME_GOAL' END,
           CASE WHEN v.routines && f.routines THEN 'SAME_ROUTINE' END,
           CASE WHEN v.interests && f.interests THEN 'SHARED_INTERESTS' END,
           CASE WHEN f.verified_at IS NOT NULL THEN 'VERIFIED' END,
           CASE WHEN f.hours_since_signup < 168 THEN 'NEW_HERE' END
         ]::text[], NULL) AS reasons
    FROM feat f CROSS JOIN viewer v
    CROSS JOIN LATERAL (SELECT
      LEAST(1, CASE WHEN f.training_now THEN 1
                    ELSE COALESCE(exp(-LEAST(f.hours_seen, 2000) / 48), 0) END
               + 0.1 * f.hour_overlap)::float8 AS activity,
      CASE WHEN f.liked_viewer THEN 1
           ELSE (f.likes_given + :priorWeight * :globalLikeRate) / (f.likes_given + f.passes_given + :priorWeight)
      END::float8 AS mutual,
      CASE WHEN f.distance_km IS NULL THEN 0 ELSE 1 - f.distance_km / :radiusKm END::float8 AS distance,
      CASE WHEN 'UNSURE' = ANY(ARRAY[:intents]::text[]) OR 'UNSURE' = ANY(f.intents) THEN 0.5
           ELSE COALESCE(f.shared_intents::float8
                / NULLIF(cardinality(ARRAY[:intents]::text[]) + cardinality(f.intents) - f.shared_intents, 0), 0)
      END::float8 AS intent,
      COALESCE((SELECT avg(signal) FROM unnest(ARRAY[
        CASE WHEN v.goal IS NULL OR f.goal IS NULL THEN NULL WHEN v.goal = f.goal THEN 1 ELSE 0 END,
        CASE WHEN cardinality(v.routines) = 0 OR cardinality(f.routines) = 0 THEN NULL
             WHEN v.routines && f.routines THEN 1 ELSE 0 END,
        CASE WHEN v.frequency IS NULL OR f.frequency IS NULL THEN NULL
             ELSE GREATEST(0, 1 - abs(v.frequency - f.frequency) / 6.0) END,
        CASE WHEN v.branch_id IS NULL OR f.sede_id IS NULL THEN NULL WHEN v.branch_id = f.sede_id THEN 1 ELSE 0 END,
        CASE WHEN cardinality(v.interests) = 0 OR cardinality(f.interests) = 0 THEN NULL
             ELSE f.shared_interests::float8
                  / (cardinality(v.interests) + cardinality(f.interests) - f.shared_interests) END,
        CASE WHEN 'DATING' = ANY(ARRAY[:intents]::text[]) AND f.social_status IS NOT NULL
             THEN CASE WHEN f.social_status = 'IN_RELATIONSHIP' THEN 0 ELSE 1 END END
      ]::float8[]) AS signal), 0)::float8 AS affinity,
      CASE WHEN f.verified_at IS NOT NULL THEN 1 ELSE 0 END::float8 AS verification,
      CASE WHEN f.hours_since_signup <= 72 THEN 1 WHEN f.hours_since_signup >= 168 THEN 0
           ELSE (168 - f.hours_since_signup) / 96 END::float8 AS novelty
    ) x
)
SELECT ranked.id, ranked.liked_viewer AS "likedViewer", ranked.is_new AS "isNew",
       ranked.distance_km AS "distanceKm", ranked.reasons, ranked.score::text AS score,
       ranked.activity, ranked.mutual, ranked.distance, ranked.intent, ranked.affinity,
       ranked.verification, ranked.novelty
  FROM (
    SELECT s.*, row_number() OVER (ORDER BY s.score DESC, s.id DESC) AS rn
      FROM scored s
     WHERE (NOT :hasExcluded OR s.id NOT IN (:excludedIds))
       AND (NOT :hasKey
            OR (s.score, s.id) < (CAST(:keyScore AS numeric), CAST(:keyId AS uuid))
            OR (:hasForced AND s.id IN (:forcedIds)))
  ) ranked
 WHERE ranked.rn <= :rowLimit OR ranked.is_new OR ranked.liked_viewer
 ORDER BY ranked.score DESC, ranked.id DESC`;
