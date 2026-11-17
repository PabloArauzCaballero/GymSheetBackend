import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../src/config/env';
import { businessNameSkeleton } from '../../src/modules/business-accounts/handle-rules';

/** Counts rows of `table t` matching `where` (uses `:userId`). */
export async function countRows(sequelize: Sequelize, table: string, where: string, userId: string): Promise<number> {
  const [row] = await sequelize.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table} t WHERE ${where}`,
    { type: QueryTypes.SELECT, replacements: { userId } },
  );
  return Number(row?.count ?? 0);
}

export async function selectOne<T extends object>(
  sequelize: Sequelize,
  sql: string,
  replacements: Record<string, unknown>,
): Promise<T | undefined> {
  const [row] = await sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements });
  return row;
}

/** Writes a real file under the local storage root, as an upload would have. */
export function writeStoredFile(key: string): string {
  const path = join(env.MEDIA_STORAGE_LOCAL_ROOT, key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `fixture ${key}`);
  return path;
}

export type SeededAccount = {
  photoKey: string;
  chatKey: string;
  selfieKey: string;
  conversationId: string;
  ownMessageId: string;
  otherMessageId: string;
  paymentOrderId: string;
};

/**
 * Puts personal data of `userId` in the data-map tables (with `otherId` as the
 * counterpart of every relation) plus the gym's tax records, straight in SQL.
 */
export async function seedPersonalData(sequelize: Sequelize, userId: string, otherId: string): Promise<SeededAccount> {
  const ids = {
    conversation: randomUUID(), ownMessage: randomUUID(), otherMessage: randomUUID(), plan: randomUUID(),
    membership: randomUUID(), entity: randomUUID(), entityPlan: randomUUID(), price: randomUUID(),
    order: randomUUID(), routine: randomUUID(), session: randomUUID(),
  };
  const photoKey = `users/${userId}/perfiles/${randomUUID()}.jpg`;
  const storyKey = `users/${userId}/stories/${randomUUID()}.jpg`;
  const reelKey = `users/${userId}/reels/${randomUUID()}.mp4`;
  const chatKey = `users/${userId}/chats/${ids.conversation}/${randomUUID()}.bin`;
  const selfieKey = `users/${userId}/verificaciones/${randomUUID()}.jpg`;
  const suffix = randomUUID().slice(0, 8);
  const statements = [
    `INSERT INTO profile.onboarding (user_id, physical_considerations, consent_health, consent_data)
       VALUES (:userId, 'Lesión de rodilla', true, true)`,
    `INSERT INTO profile.body_measurements (user_id, weight, unit, measured_on, source, created_by_user_id)
       VALUES (:userId, 80, 'KG', CURRENT_DATE, 'USER', :userId)`,
    `INSERT INTO public.perfiles_antropometricos (usuario_id, peso_kg, estatura_cm, objetivo)
       VALUES (:userId, 80, 180, 'HIPERTROFIA')`,
    `INSERT INTO public.sesiones_entrenamiento (id, usuario_id) VALUES ('${ids.session}', :userId)`,
    `INSERT INTO training.routines (id, nombre, created_by_user_id) VALUES ('${ids.routine}', 'Mi rutina', :userId)`,
    `INSERT INTO progression.user_progress (usuario_id) VALUES (:userId)`,
    `INSERT INTO social.profile_details (user_id, bio) VALUES (:userId, 'Me gusta correr')`,
    `INSERT INTO social.profile_settings (user_id) VALUES (:userId)`,
    `INSERT INTO social.discovery_preferences (user_id, genders, intents, min_age, max_age, radius_km, flexible_age, flexible_distance)
       VALUES (:userId, ARRAY['FEMALE'], ARRAY['TRAINING'], 18, 40, 10, false, false)`,
    `INSERT INTO social.map_locations (user_id, latitude, longitude, cell_id) VALUES (:userId, -16.5, -68.15, 'c1')`,
    `INSERT INTO social.connections (requester_id, addressee_id) VALUES (:userId, :otherId)`,
    `INSERT INTO social.discovery_passes (viewer_id, target_id) VALUES (:otherId, :userId)`,
    `INSERT INTO social.user_blocks (blocker_id, blocked_id) VALUES (:userId, :otherId)`,
    `INSERT INTO profile.profile_views (viewer_id, viewed_user_id, tenant_id) VALUES (:otherId, :userId, 'default')`,
    `INSERT INTO profile.photos (user_id, url, storage_provider, storage_key) VALUES (:userId, 'http://x/${photoKey}', 'local', '${photoKey}')`,
    `INSERT INTO profile.stories (user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at)
       VALUES (:userId, 'default', 'http://x/${storyKey}', 'local', '${storyKey}', 'image', now() + interval '1 day')`,
    `INSERT INTO social.reels (user_id, tenant_id, storage_provider, storage_key, mime_type, duration_seconds)
       VALUES (:userId, 'default', 'local', '${reelKey}', 'video/mp4', 10)`,
    `INSERT INTO social.photo_verifications (user_id, gesture_code, challenge_issued_at, challenge_expires_at,
       selfie_storage_key, selfie_mime_type, status, submitted_at)
       VALUES (:userId, 'THUMB_UP', now(), now() + interval '10 minutes', '${selfieKey}', 'image/jpeg', 'PENDING_REVIEW', now())`,
    `INSERT INTO community.content_comments (target_kind, target_id, autor_id, texto)
       VALUES ('ROUTINE', '${ids.routine}', :userId, 'Buen plan')`,
    `INSERT INTO chat.conversations (id) VALUES ('${ids.conversation}')`,
    `INSERT INTO chat.participants (conversation_id, user_id, nickname) VALUES ('${ids.conversation}', :userId, 'Yo'), ('${ids.conversation}', :otherId, NULL)`,
    `INSERT INTO chat.messages (id, conversation_id, sender_id, body, type, media_key, media_provider)
       VALUES ('${ids.ownMessage}', '${ids.conversation}', :userId, 'Mi secreto', 'image', '${chatKey}', 'local'),
              ('${ids.otherMessage}', '${ids.conversation}', :otherId, 'Respuesta ajena', 'text', NULL, NULL)`,
    `INSERT INTO notifications.messages (id, recipient_user_id, channel, body, deduplication_key)
       VALUES ('${randomUUID()}', :userId, 'IN_APP', 'Hola', 'fixture-${suffix}')`,
    `INSERT INTO notifications.device_tokens (id, user_id, platform, push_token) VALUES ('${randomUUID()}', :userId, 'ANDROID', 'tok-${suffix}')`,
    `INSERT INTO auth.user_devices (user_id, installation_id) VALUES (:userId, '${randomUUID()}')`,
    `INSERT INTO access_control.credentials (id, user_id, credential_type, provider, pin_hash)
       VALUES ('${randomUUID()}', :userId, 'PIN', 'INTERNAL', '$2a$04$fixturefixturefixturefixtureuWl4rK2P1z8cE6Z5sJ8Yv0m')`,
    // The gym's tax records.
    `INSERT INTO retired.membership_plans (id, code, name, duration_days) VALUES ('${ids.plan}', 'F4-${suffix}', 'Mensual', 30)`,
    `INSERT INTO membership.memberships (id, user_id, retired_plan_id, starts_on, ends_on, notes, offer_kind, plan_name)
       VALUES ('${ids.membership}', :userId, '${ids.plan}', CURRENT_DATE, CURRENT_DATE + 30, 'Paga en efectivo', 'MEMBERSHIP', 'Mensual')`,
    `INSERT INTO retired.membership_customer_profiles (id, user_id, customer_number, phone_number, notes)
       VALUES ('${randomUUID()}', :userId, 'C-${suffix}', '+59170000000', 'Prefiere mañanas')`,
    `INSERT INTO directory.entities (id, slug, entity_type, name, name_skeleton, description, primary_category_id)
       VALUES ('${ids.entity}', 'f4-${suffix}', 'GYM', 'Gimnasio F4', '${businessNameSkeleton('Gimnasio F4')}', 'Prueba', 'a1000000-0000-4000-8000-000000000001')`,
    `INSERT INTO directory.entity_plans (id, entity_id, name, slug, description, current_price)
       VALUES ('${ids.entityPlan}', '${ids.entity}', 'Plan', 'plan-${suffix}', 'Plan', 150)`,
    `INSERT INTO directory.plan_price_history (id, plan_id, price, currency, changed_by_user_id, change_reason)
       VALUES ('${ids.price}', '${ids.entityPlan}', 150, 'USD', :otherId, 'Alta')`,
    `INSERT INTO directory.payment_orders (id, order_number, entity_id, plan_id, athlete_user_id, price_history_id,
       amount, currency, plan_snapshot, athlete_notes, receipt_reference)
       VALUES ('${ids.order}', 'ORD-${suffix}', '${ids.entity}', '${ids.entityPlan}', :userId, '${ids.price}',
       150, 'USD', '{}'::jsonb, 'Llámame al 70000000', 'BANCO-123')`,
  ];
  for (const statement of statements) {
    await sequelize.query(statement, { replacements: { userId, otherId } });
  }
  return {
    photoKey,
    chatKey,
    selfieKey,
    conversationId: ids.conversation,
    ownMessageId: ids.ownMessage,
    otherMessageId: ids.otherMessage,
    paymentOrderId: ids.order,
  };
}
