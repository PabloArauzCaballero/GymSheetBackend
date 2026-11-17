/**
 * What the full export (`POST /me/export`) contains: one section per table of
 * the data map, own rows only. Credential material (password, token and PIN
 * hashes) is never exported, and neither are secret notifications (a message
 * that carried a PIN): their body is the credential. For chats, only the
 * person's own messages and the ids of their conversations: other people's
 * content is theirs.
 *
 * Moderation follows the reporter-anonymity promise: reports received and the
 * evidence copy of a reported chat message (`moderation.chat_message_evidence`)
 * are NOT exported. In a one-to-one chat the mere existence of a copy names
 * the reporter, which the right of access may not do to a third party; the
 * message itself is already in `chat.messages` while the sender keeps it. The
 * review of an auto-hidden content is exported to its author, who was told
 * about the hiding, without the moderator's id. The same holds for the person
 * verification: its decision is exported, the selfie (biometric data) and the
 * moderator are not.
 */
export type AccountExportSection = {
  /** `schema.table`; also the key in the archive. */
  table: string;
  label: string;
  /** Predicate over alias `t`; uses `:userId`. */
  where: string;
  /** Columns left out of each row. */
  omit?: readonly string[];
};

const OWN = "t.user_id = :userId";
const OWN_ES = "t.usuario_id = :userId";
const OWN_SESSIONS = "SELECT s.id FROM public.sesiones_entrenamiento s WHERE s.usuario_id = :userId";
const OWN_SESSION_EXERCISES = `SELECT se.id FROM public.sesiones_ejercicios se WHERE se.sesion_id IN (${OWN_SESSIONS})`;
const OWN_MEMBERSHIPS = "SELECT m.id FROM membership.memberships m WHERE m.user_id = :userId";

const section = (table: string, label: string, where: string, omit?: readonly string[]): AccountExportSection => ({
  table,
  label,
  where,
  omit,
});

export const ACCOUNT_EXPORT_SECTIONS: readonly AccountExportSection[] = [
  // Account and access.
  section("public.usuarios", "Cuenta", "t.id = :userId", ["password_hash"]),
  section("auth.terms_acceptances", "Aceptaciones legales", OWN),
  section("auth.consents", "Consentimientos de datos sensibles", OWN),
  section("auth.refresh_tokens", "Sesiones", OWN, ["token_hash"]),
  section("auth.user_devices", "Dispositivos", OWN),
  section("auth.identities", "Google o Apple", OWN),
  section("auth.signup_audit", "Auditoría del alta", OWN),
  section("auth.email_verification_pins", "Códigos enviados a tu correo", OWN, ["pin_hash"]),
  section("public.password_reset_tokens", "Recuperación de contraseña", OWN_ES, ["pin_hash"]),
  // Training and health.
  section("public.perfiles_antropometricos", "Peso, estatura y objetivo", OWN_ES),
  section("profile.body_measurements", "Historial de peso", OWN),
  section("profile.onboarding", "Cuestionario inicial", OWN),
  section("profile.tutorial_progress", "Tutoriales", OWN),
  section("public.sesiones_entrenamiento", "Sesiones de entrenamiento", OWN_ES),
  section("public.sesiones_ejercicios", "Ejercicios de tus sesiones", `t.sesion_id IN (${OWN_SESSIONS})`),
  section("public.series_entrenamiento", "Series", `t.sesion_ejercicio_id IN (${OWN_SESSION_EXERCISES})`),
  section("public.series_saltadas", "Series saltadas", `t.sesion_ejercicio_id IN (${OWN_SESSION_EXERCISES})`),
  section("public.sesiones_ejercicios_cambios", "Cambios de ejercicio", OWN_ES),
  section("public.usuarios_ejercicios", "Ejercicios elegidos", OWN_ES),
  section("public.ejercicios", "Ejercicios propios", "t.tipo_ejercicio = 'PERSONAL' AND t.created_by_usuario_id = :userId"),
  section("training.routines", "Rutinas creadas", "t.created_by_user_id = :userId"),
  section("training.routine_shares", "Rutinas compartidas", "t.propietario_id = :userId OR t.invitado_id = :userId"),
  section("training.routine_assignments", "Rutinas asignadas", "t.cliente_user_id = :userId"),
  section("training.training_programs", "Programas", OWN_ES),
  section("training.cardio_plans", "Planes de cardio", OWN_ES),
  section("training.user_exercise_preferences", "Preferencias de ejercicios", OWN_ES),
  section("training.mode_reward_ledger", "Recompensas por modo", OWN_ES),
  section("training.training_invites", "Invitaciones a entrenar", "t.inviter_id = :userId OR t.recipient_id = :userId"),
  section("training.routine_progress_download_audits", "Descargas de progreso", OWN),
  // La Senda.
  section("progression.user_progress", "Puntos y nivel", OWN_ES),
  section("progression.user_badges", "Insignias", OWN_ES),
  section("progression.user_prizes", "Premios", OWN_ES),
  section("progression.user_streak_strikes", "Faltas de racha", OWN_ES),
  section("progression.weekly_challenges", "Retos semanales", OWN_ES),
  section("progression.rest_day_preferences", "Días de descanso", OWN_ES),
  // Conocer and social content.
  section("profile.photos", "Fotos de perfil", OWN),
  section("social.profile_details", "Perfil de Conocer", OWN),
  section("social.profile_settings", "Ajustes de visibilidad", OWN),
  section("social.discovery_preferences", "Preferencias de Conocer", OWN),
  section("social.map_locations", "Ubicación del mapa social", OWN),
  section("social.connections", "Likes y conexiones", "t.requester_id = :userId OR t.addressee_id = :userId"),
  section("social.discovery_passes", "Descartes que hiciste", "t.viewer_id = :userId"),
  section("social.discovery_impressions", "Perfiles que se te mostraron", "t.viewer_id = :userId"),
  section("social.user_blocks", "Personas que bloqueaste", "t.blocker_id = :userId"),
  section("profile.profile_views", "Vistas de perfil", "t.viewer_id = :userId OR t.viewed_user_id = :userId"),
  section("social.recommendation_profile_versions", "Versión del perfil en el recomendador", OWN),
  // Status, gesture, dates and decision reason; never the selfie's storage key nor who reviewed it.
  section("social.photo_verifications", "Verificación de identidad", OWN, ["selfie_storage_key", "reviewer_id"]),
  section("profile.stories", "Historias", OWN),
  section("profile.story_audiences", "Audiencias de historias", OWN),
  section("profile.story_views", "Historias que viste", "t.viewer_id = :userId"),
  section("social.reels", "Reels", OWN),
  section("social.reel_comments", "Comentarios en reels", OWN),
  section("social.reel_likes", "Me gusta en reels", OWN),
  section("social.reel_saves", "Reels guardados", OWN),
  section("social.reel_reposts", "Reels compartidos", OWN),
  // Chat: own messages and conversation ids only.
  section("chat.participants", "Tus conversaciones", OWN),
  section("chat.messages", "Tus mensajes", "t.sender_id = :userId", ["idempotency_body", "deleted_request_hash"]),
  section("chat.message_reactions", "Tus reacciones", OWN),
  section("chat.message_visibility", "Mensajes que ocultaste", OWN),
  section("chat.read_receipt_settings", "Confirmación de lectura", OWN),
  // Community, directory and moderation.
  section("community.content_comments", "Comentarios", "t.autor_id = :userId"),
  section("community.comment_likes", "Me gusta en comentarios", OWN_ES),
  section("community.content_ratings", "Valoraciones", OWN_ES),
  section("community.exercise_likes", "Me gusta en ejercicios", OWN_ES),
  section("community.music_playlists", "Listas de música", OWN),
  section("directory.reviews", "Reseñas", OWN),
  section("directory.review_replies", "Respuestas a reseñas", "t.author_id = :userId"),
  section("directory.review_helpful_votes", "Votos de utilidad", OWN),
  section("moderation.reports", "Denuncias que hiciste", "t.reporter_user_id = :userId"),
  section("moderation.user_strikes", "Sanciones", OWN),
  section("moderation.auto_hide_reviews", "Contenido ocultado por denuncias", "t.author_user_id = :userId",
    ["reviewed_by_user_id"]),
  // The gym's records about you.
  section("membership.customer_profiles", "Ficha de socio", OWN),
  section("membership.memberships", "Membresías", OWN),
  section("membership.status_history", "Historial de membresías", `t.membership_id IN (${OWN_MEMBERSHIPS})`),
  section("membership.extensions", "Extensiones de membresía", `t.membership_id IN (${OWN_MEMBERSHIPS})`),
  section("membership.intents", "Compras de membresía", OWN),
  section("membership.entitlements", "Beneficios", OWN),
  section("public.membership_activation_requests", "Activaciones", OWN_ES, ["token_hash"]),
  // The receipt's storage key is internal; the receipt itself is read at its own route (ADR-0024).
  section("directory.payment_orders", "Órdenes de pago", "t.athlete_user_id = :userId", ["receipt_private_key"]),
  section("directory.payment_order_history", "Historial de tus pedidos",
    "t.order_id IN (SELECT o.id FROM directory.payment_orders o WHERE o.athlete_user_id = :userId)", ["actor_user_id"]),
  section("access_control.credentials", "Credenciales de acceso", OWN, ["pin_hash"]),
  section("access_control.decisions", "Entradas al gimnasio", OWN),
  // Notifications.
  section("notifications.messages", "Avisos recibidos", "t.recipient_user_id = :userId AND NOT t.secret"),
  section("notifications.device_tokens", "Permisos push", OWN, ["push_token", "auth", "p256dh"]),
  section("notifications.preferences", "Preferencias de avisos", OWN),
  // Business KYC (ADR-0021): filled only for a business account, whose export opens in franja 8f.
  // Ciphertexts, keyed hashes and the claiming moderator never leave; the automatic checks are not
  // exported either: their outcomes would tell which datum is on the blocklist.
  section("business.kyc_submissions", "Verificación del negocio", "t.account_id = :userId",
    ["nit_enc", "nit_hmac", "rep_ci_enc", "rep_ci_hmac", "phone_enc", "phone_hmac", "claimed_by_user_id", "claimed_at"]),
  section("business.kyc_documents", "Documentos de la verificación",
    "t.submission_id IN (SELECT s.id FROM business.kyc_submissions s WHERE s.account_id = :userId)", ["storage_key", "storage_provider"]),
  section("business.kyc_decisions", "Decisiones sobre la verificación",
    "t.submission_id IN (SELECT s.id FROM business.kyc_submissions s WHERE s.account_id = :userId)", ["actor_user_id", "note"]),
  section("business.phone_verifications", "Verificación del teléfono", "t.account_id = :userId", ["phone_enc", "phone_hmac", "code_hash"]),
];
