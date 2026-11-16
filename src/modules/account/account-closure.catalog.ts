import {
  ClosureStep,
  WIPED_MESSAGE_FIELDS,
  anonymize,
  del,
  keep,
  ownExerciseUploadKey,
  ownFolderKey,
  reported,
  routineUsedByOthers,
} from "./account-closure.steps";

const OWN = "t.user_id = :userId";
const OWN_ES = "t.usuario_id = :userId";

/**
 * Conversations of the person with the platform or the gym (no third party's
 * history). The person is the member side (`can_write = false`, see
 * `createSystemConversation`): when a gym admin's account closes, the
 * members' chats with the gym it answered stay theirs.
 */
const systemConversation = (alias: string): string => `${alias}.system_kind IS NOT NULL
  AND EXISTS (SELECT 1 FROM chat.participants p
               WHERE p.conversation_id = ${alias}.id AND p.user_id = :userId AND p.can_write = false)
  AND NOT EXISTS (SELECT 1 FROM chat.messages m WHERE m.conversation_id = ${alias}.id AND ${reported("CHAT_MESSAGE", "m.id")})`;
const IN_SYSTEM_CONVERSATION = `t.conversation_id IN (SELECT c.id FROM chat.conversations c WHERE ${systemConversation("c")})`;

const OWN_PERSONAL_EXERCISE = "t.tipo_ejercicio = 'PERSONAL' AND t.created_by_usuario_id = :userId";
const EXERCISE_USED_ELSEWHERE = `(
  EXISTS (SELECT 1 FROM public.sesiones_ejercicios se JOIN public.sesiones_entrenamiento s ON s.id = se.sesion_id
           WHERE se.ejercicio_id = t.id AND s.usuario_id <> :userId)
  OR EXISTS (SELECT 1 FROM training.routine_exercises re JOIN training.routines r ON r.id = re.routine_id
              WHERE re.ejercicio_id = t.id AND (r.created_by_user_id <> :userId OR ${routineUsedByOthers("r")}))
  OR EXISTS (SELECT 1 FROM training.program_lift_targets lt JOIN training.training_programs p ON p.id = lt.program_id
              WHERE lt.ejercicio_id = t.id AND p.usuario_id <> :userId))`;

/** Storage keys of a personal exercise upload in the owner's folder: the file and its poster. */
const OWN_EXERCISE_UPLOAD_KEYS = [ownExerciseUploadKey("t.url"), ownExerciseUploadKey("t.thumbnail_url")] as const;
const OWN_EXERCISE_UPLOAD = `t.ejercicio_id IN (SELECT e.id FROM public.ejercicios e WHERE e.tipo_ejercicio = 'PERSONAL' AND e.created_by_usuario_id = :userId)
     AND (${OWN_EXERCISE_UPLOAD_KEYS[0]} IS NOT NULL OR ${OWN_EXERCISE_UPLOAD_KEYS[1]} IS NOT NULL)`;
/** A report on the exercise makes its uploads evidence, held ones (author deleted under the report) included. */
const EXERCISE_REPORTED = reported("EXERCISE", "t.ejercicio_id");

const HAS_OTHERS_REPLIES =
  "EXISTS (SELECT 1 FROM community.content_comments c WHERE c.respuesta_a = t.id AND c.autor_id <> :userId)";

const GYM_RECORD = "El gimnasio debe conservarlo por obligación tributaria o contable; ya no lleva tu nombre ni tu correo.";

/**
 * Every personal-data table of the data map and what the closure does with it,
 * in FK-safe execution order. `public.usuarios` goes last (see repository).
 *
 * Child tables that cascade from a row deleted here (series of a session,
 * revisions of an invite, delivery attempts of a notice…) are covered by their
 * parent's step.
 */
export const ACCOUNT_CLOSURE_STEPS: readonly ClosureStep[] = [
  // Sessions, credentials and account security.
  del("auth.refresh_tokens", "Sesiones abiertas", OWN),
  del("auth.user_devices", "Dispositivos", OWN),
  del("auth.identities", "Inicio de sesión con Google o Apple", OWN),
  del("auth.email_verification_pins", "Códigos enviados a tu correo", OWN),
  del("public.password_reset_tokens", "Códigos de recuperación de contraseña", OWN_ES),
  del("auth.account_exports", "Copias de tus datos", OWN),
  anonymize("auth.signup_audit", "Registro antifraude del alta", OWN, "user_id = NULL",
    "Se conserva sin vínculo a tu cuenta para frenar altas automatizadas."),
  keep("auth.terms_acceptances", "Aceptación de términos y privacidad", OWN,
    "Prueba de qué versión aceptaste y cuándo."),
  anonymize("auth.consents", "Consentimientos de datos sensibles", OWN, "revoked_at = COALESCE(t.revoked_at, now())",
    "Se revocan todos; queda la prueba de qué aceptaste y cuándo."),

  // Notifications (pending deliveries first: their notice is about to go). A
  // self-contained notice email marked `survivesClosure` (the notice of this
  // very closure, decided by moderation) is the one pending delivery kept.
  { ...del("integration.outbox_jobs", "Avisos pendientes de envío",
    `t.queue_name = 'notifications.delivery' AND t.status IN ('PENDING', 'FAILED')
     AND (t.payload->>'notificationId' IN (SELECT m.id::text FROM notifications.messages m WHERE m.recipient_user_id = :userId)
          OR (t.payload->>'recipientUserId' = CAST(:userId AS text) AND t.payload->>'survivesClosure' = 'false'))`),
    internal: true },
  del("notifications.messages", "Avisos y correos recibidos", "t.recipient_user_id = :userId"),
  del("notifications.device_tokens", "Permisos de notificación push", OWN),
  del("notifications.preferences", "Preferencias de avisos", OWN),

  // Profile, health and training.
  del("profile.onboarding", "Cuestionario inicial y consideraciones físicas", OWN),
  del("profile.body_measurements", "Historial de peso", OWN),
  del("public.perfiles_antropometricos", "Peso, estatura y objetivo", OWN_ES),
  del("profile.tutorial_progress", "Progreso de tutoriales", OWN),
  del("training.training_invites", "Invitaciones a entrenar", "t.inviter_id = :userId OR t.recipient_id = :userId"),
  del("training.mode_reward_ledger", "Recompensas por modo de entrenamiento", OWN_ES),
  del("training.training_programs", "Programas de entrenamiento", OWN_ES),
  del("training.cardio_plans", "Planes de cardio", OWN_ES),
  del("public.sesiones_ejercicios_cambios", "Cambios de ejercicio en sesiones", OWN_ES),
  del("public.sesiones_entrenamiento", "Sesiones, ejercicios y series registradas", OWN_ES),
  del("training.user_exercise_preferences", "Preferencias de ejercicios", OWN_ES),
  del("training.routine_shares", "Rutinas compartidas", "t.propietario_id = :userId OR t.invitado_id = :userId"),
  del("training.routine_assignments", "Rutinas asignadas", "t.cliente_user_id = :userId"),
  keep("training.routine_assignments", "Rutinas que asignaste a socios",
    "t.asignado_por_user_id = :userId AND t.cliente_user_id <> :userId",
    "Son parte del plan de cada socio; quedan a nombre de «Cuenta cerrada»."),
  del("training.routine_progress_download_audits", "Descargas de tu progreso", OWN),
  anonymize("training.routines", "Tu nombre en copias de tus rutinas", "t.atribucion->>'authorId' = :userId",
    `atribucion = jsonb_set(jsonb_set(t.atribucion, '{authorId}', 'null'::jsonb), '{authorName}', '"Cuenta cerrada"'::jsonb)`,
    "Las copias de otras personas citan «Cuenta cerrada»."),
  del("training.routines", "Rutinas creadas por ti",
    `t.created_by_user_id = :userId AND NOT ${routineUsedByOthers("t")}`),
  keep("training.routines", "Rutinas que publicaste y otras personas usan",
    `t.created_by_user_id = :userId AND ${routineUsedByOthers("t")}`,
    "Siguen en el entrenamiento de esas personas, firmadas como «Cuenta cerrada»."),
  del("public.usuarios_ejercicios", "Ejercicios elegidos", OWN_ES),
  // Uploads to personal exercises live in the owner's folder (ADR-0017): they
  // go, file and poster, even when the exercise itself is kept for someone
  // else's routine. A reported exercise keeps them (and itself) as evidence,
  // until the reported-content retention erases them.
  del("training.exercise_media", "Fotos y videos que subiste a tus ejercicios propios",
    `${OWN_EXERCISE_UPLOAD} AND NOT ${EXERCISE_REPORTED}`, OWN_EXERCISE_UPLOAD_KEYS),
  keep("training.exercise_media", "Fotos y videos de tus ejercicios denunciados",
    `${OWN_EXERCISE_UPLOAD} AND ${EXERCISE_REPORTED}`, "Evidencia de una denuncia en revisión de moderación."),
  del("public.ejercicios", "Ejercicios propios",
    `${OWN_PERSONAL_EXERCISE} AND NOT ${EXERCISE_USED_ELSEWHERE} AND NOT ${reported("EXERCISE")}`),
  keep("public.ejercicios", "Ejercicios propios que usan rutinas ajenas",
    `${OWN_PERSONAL_EXERCISE} AND ${EXERCISE_USED_ELSEWHERE}`,
    "Forman parte de rutinas de otras personas; no llevan tu nombre."),
  keep("public.ejercicios", "Ejercicios propios denunciados",
    `${OWN_PERSONAL_EXERCISE} AND NOT ${EXERCISE_USED_ELSEWHERE} AND ${reported("EXERCISE")}`,
    "Evidencia de una denuncia en revisión de moderación."),

  // La Senda.
  del("progression.user_progress", "Puntos y nivel", OWN_ES),
  del("progression.user_badges", "Insignias", OWN_ES),
  del("progression.user_prizes", "Premios", OWN_ES),
  del("progression.user_streak_strikes", "Faltas de racha", OWN_ES),
  del("progression.weekly_challenges", "Retos semanales", OWN_ES),
  del("progression.rest_day_preferences", "Días de descanso", OWN_ES),

  // Conocer, social content and its files.
  del("profile.photos", "Fotos de perfil", `${OWN} AND NOT ${reported("PROFILE_PHOTO")}`, "t.storage_key"),
  keep("profile.photos", "Fotos de perfil denunciadas", `${OWN} AND ${reported("PROFILE_PHOTO")}`,
    "Evidencia de una denuncia en revisión de moderación."),
  del("profile.story_views", "Historias que viste", "t.viewer_id = :userId"),
  del("profile.story_audiences", "Audiencias de historias", OWN),
  del("profile.stories", "Historias", `${OWN} AND NOT ${reported("STORY")}`, "t.storage_key"),
  keep("profile.stories", "Historias denunciadas", `${OWN} AND ${reported("STORY")}`,
    "Evidencia de una denuncia en revisión de moderación."),
  del("social.reel_likes", "Me gusta en reels", OWN),
  del("social.reel_saves", "Reels guardados", OWN),
  del("social.reel_reposts", "Reels compartidos", OWN),
  del("social.reel_comments", "Comentarios en reels", OWN),
  del("social.reels", "Reels", `${OWN} AND NOT ${reported("REEL")}`, "t.storage_key"),
  keep("social.reels", "Reels denunciados", `${OWN} AND ${reported("REEL")}`,
    "Evidencia de una denuncia en revisión de moderación."),
  // The reviewer FK is staff-only (closure is for members) and SET NULL on its own.
  del("social.photo_verifications", "Verificación de identidad con selfie", OWN, "t.selfie_storage_key"),
  del("social.profile_details", "Perfil de Conocer (intereses, hábitos, bio, orientación)", OWN),
  del("social.profile_settings", "Ajustes de visibilidad", OWN),
  del("social.discovery_preferences", "Preferencias de Conocer", OWN),
  del("social.map_locations", "Ubicación del mapa social", OWN),
  del("social.connections", "Likes y conexiones", "t.requester_id = :userId OR t.addressee_id = :userId"),
  del("social.discovery_passes", "Descartes", "t.viewer_id = :userId OR t.target_id = :userId"),
  del("social.discovery_impressions", "Perfiles mostrados", "t.viewer_id = :userId OR t.target_id = :userId"),
  del("social.user_blocks", "Bloqueos", "t.blocker_id = :userId OR t.blocked_id = :userId"),
  del("profile.profile_views", "Vistas de perfil", "t.viewer_id = :userId OR t.viewed_user_id = :userId"),
  keep("social.recommendation_profile_versions", "Versión del perfil en el recomendador", OWN,
    "Contador técnico sin datos personales que ordena tu baja en el recomendador."),

  // Community and directory.
  del("community.comment_likes", "Me gusta en comentarios", OWN_ES),
  del("community.content_ratings", "Valoraciones", OWN_ES),
  del("community.exercise_likes", "Me gusta en ejercicios", OWN_ES),
  del("community.content_comments", "Comentarios",
    `t.autor_id = :userId AND NOT ${HAS_OTHERS_REPLIES} AND NOT ${reported("COMMENT")}`, ownFolderKey("t.adjunto_url")),
  anonymize("community.content_comments", "Comentarios con respuestas de otras personas",
    `t.autor_id = :userId AND ${HAS_OTHERS_REPLIES} AND NOT ${reported("COMMENT")}`,
    `estado = 'BORRADO_AUTOR', texto = '', adjunto_tipo = NULL, adjunto_url = NULL, adjunto_mime = NULL,
     adjunto_nombre = NULL, adjunto_bytes = NULL, adjunto_ancho = NULL, adjunto_alto = NULL`,
    "Queda «comentario borrado» para que las respuestas ajenas no pierdan su hilo.", ownFolderKey("t.adjunto_url")),
  keep("community.content_comments", "Comentarios denunciados", `t.autor_id = :userId AND ${reported("COMMENT")}`,
    "Evidencia de una denuncia en revisión de moderación."),
  del("community.music_playlists", "Listas de música", `${OWN} AND NOT ${reported("MUSIC_PLAYLIST")}`),
  keep("community.music_playlists", "Listas de música denunciadas", `${OWN} AND ${reported("MUSIC_PLAYLIST")}`,
    "Evidencia de una denuncia en revisión de moderación."),
  del("directory.review_helpful_votes", "Votos de utilidad en reseñas", OWN),
  del("directory.review_replies", "Respuestas a reseñas", "t.author_id = :userId"),
  del("directory.reviews", "Reseñas del directorio", OWN),
  anonymize("directory.entities", "Ficha del directorio a tu nombre", OWN, "user_id = NULL",
    "La ficha del negocio sigue publicada sin vínculo a tu cuenta."),

  // Chat: own content is wiped; the other person keeps their own messages.
  del("chat.message_reactions", "Reacciones en el chat", OWN),
  del("chat.message_visibility", "Mensajes que ocultaste", OWN),
  del("chat.read_receipt_settings", "Ajuste de confirmación de lectura", OWN),
  del("chat.messages", "Mensajes de tus chats con REPP y con tu gimnasio", IN_SYSTEM_CONVERSATION, "t.media_key"),
  del("chat.conversations", "Chats con REPP y con tu gimnasio", systemConversation("t")),
  anonymize("chat.messages", "Tus mensajes, fotos, audios y ubicaciones",
    `t.sender_id = :userId AND NOT ${reported("CHAT_MESSAGE")} AND NOT ${IN_SYSTEM_CONVERSATION}`, WIPED_MESSAGE_FIELDS,
    "Queda «mensaje eliminado» en el chat de la otra persona.", "t.media_key"),
  keep("chat.messages", "Mensajes denunciados", `t.sender_id = :userId AND ${reported("CHAT_MESSAGE")}`,
    "Evidencia de una denuncia en revisión de moderación."),
  { ...anonymize("chat.participants", "Chats con otras personas",
    "t.user_id <> :userId AND t.conversation_id IN (SELECT p.conversation_id FROM chat.participants p WHERE p.user_id = :userId)",
    "can_write = false", "El chat queda de solo lectura para la otra persona."), internal: true },
  anonymize("chat.participants", "Tu participación en chats", OWN,
    `can_write = false, nickname = NULL, last_delivered_at = NULL, last_read_at = NULL,
     read_receipts_enabled = NULL, read_receipts_enabled_since = NULL, last_receipt_read_at = NULL`,
    "La otra persona conserva sus propios mensajes; tu nombre pasa a «Cuenta cerrada»."),
  anonymize("chat.conversation_timer_events", "Cambios de mensajes temporales", "t.changed_by_user_id = :userId",
    "changed_by_user_id = NULL", "El cambio queda sin autor."),
  anonymize("chat.conversations", "Chats que cerraste", "t.revoked_by_user_id = :userId",
    "revoked_by_user_id = NULL", "El cierre queda sin autor."),

  // Moderation evidence.
  keep("moderation.reports", "Denuncias que hiciste o recibiste",
    "t.reporter_user_id = :userId OR t.reported_user_id = :userId", "Evidencia de moderación y seguridad."),
  keep("moderation.user_strikes", "Sanciones", OWN, "Evidencia de moderación y seguridad."),
  // Legal evidence (no FK on purpose, see migration 202611180401): kept while a report is open and
  // then deleted by its own retention (ModerationEvidenceService.purgeExpired), never by the closure.
  keep("moderation.chat_message_evidence", "Copias de mensajes denunciados", "t.sender_id = :userId",
    "Evidencia legal de una denuncia: se conserva mientras está abierta y se borra 180 días después de cerrarse."),
  keep("moderation.auto_hide_reviews", "Revisiones de contenido ocultado por denuncias", "t.author_user_id = :userId",
    "Registro de la revisión de moderación del contenido ocultado; no lleva tu nombre ni tu correo."),

  // The gym's records (the gym is responsible; REPP only processes them).
  anonymize("membership.staff_profiles", "Ficha de personal del gimnasio", OWN,
    `employment_status = 'TERMINATED', terminated_on = GREATEST(t.hired_on, COALESCE(t.terminated_on, CURRENT_DATE)),
     unlimited_access = false, metadata = '{}'::jsonb, updated_at = now()`,
    "El gimnasio conserva el puesto y las fechas de la relación laboral; la ficha queda dada de baja."),
  anonymize("membership.customer_profiles", "Ficha de socio del gimnasio", OWN,
    "phone_number = NULL, notes = NULL, metadata = '{}'::jsonb, updated_at = now()", GYM_RECORD),
  anonymize("membership.memberships", "Membresías", OWN, "notes = NULL, updated_at = now()", GYM_RECORD),
  keep("membership.status_history", "Historial de tus membresías",
    "t.membership_id IN (SELECT m.id FROM membership.memberships m WHERE m.user_id = :userId)", GYM_RECORD),
  keep("membership.extensions", "Extensiones de membresía",
    "t.membership_id IN (SELECT m.id FROM membership.memberships m WHERE m.user_id = :userId)", GYM_RECORD),
  keep("membership.intents", "Compras de membresía", OWN, GYM_RECORD),
  keep("membership.entitlements", "Beneficios de membresía", OWN, GYM_RECORD),
  anonymize("directory.payment_orders", "Órdenes de pago y comprobantes", "t.athlete_user_id = :userId",
    "athlete_notes = NULL, updated_at = now()", GYM_RECORD),
  anonymize("public.membership_activation_requests", "Activaciones de membresía", OWN_ES,
    "nota = NULL, updated_at = now()", GYM_RECORD),
  anonymize("access_control.credentials", "Credenciales de acceso al gimnasio", OWN,
    `status = 'REVOKED', revoked_at = COALESCE(t.revoked_at, now()), revocation_reason = 'Cuenta cerrada',
     metadata = '{}'::jsonb, updated_at = now()`,
    "Se revocan. El gimnasio conserva el registro y debe borrar la plantilla de su propio equipo."),
  keep("access_control.decisions", "Registro de entradas al gimnasio", OWN, GYM_RECORD),

  // Internal records that only carry the account id.
  keep("integration.domain_events", "Registro técnico de eventos", "t.actor_user_id = :userId",
    "Registro interno de operaciones; no se muestra a nadie."),
  del("admin.user_permissions", "Permisos de personal", OWN),
  // Copies of the gym-level moderation grants retired by ADR-0018, kept only for rollback.
  del("admin.retired_permission_grants", "Permisos de personal retirados", OWN),
  keep("admin.audit_log", "Bitácora de administración", "t.actor_user_id = :userId",
    "Registro de seguridad de acciones de personal."),

  // REPP moderators' trace on the business KYC (ADR-0021). The business's own KYC rows hang
  // from `business.accounts`, whose closure catalogue arrives with franja 8f.
  anonymize("business.kyc_submissions", "Verificaciones de negocios que tenías tomadas", "t.claimed_by_user_id = :userId",
    "claimed_by_user_id = NULL, claimed_at = NULL", "La solicitud vuelve a la cola sin tu nombre."),
  keep("business.kyc_decisions", "Decisiones sobre verificaciones de negocios", "t.actor_user_id = :userId",
    "Registro de las decisiones de REPP: quién aprobó o rechazó un negocio."),
  keep("business.kyc_status_history", "Historial de verificaciones de negocios", "t.actor_user_id = :userId",
    "Registro de las decisiones de REPP: quién aprobó o rechazó un negocio."),
  anonymize("business.blocklist", "Lista de bloqueo de negocios", "t.created_by_user_id = :userId OR t.removed_by_user_id = :userId",
    "created_by_user_id = NULLIF(t.created_by_user_id, CAST(:userId AS uuid)), removed_by_user_id = NULLIF(t.removed_by_user_id, CAST(:userId AS uuid))",
    "La entrada sigue vigente sin tu nombre."),
  anonymize("business.banned_terms", "Términos prohibidos para negocios", "t.created_by_user_id = :userId",
    "created_by_user_id = NULL", "El término sigue vigente sin tu nombre."),
];
