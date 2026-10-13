import type { BadgeCategory, BadgeCriterionType, BadgeRarity, BadgeSeed } from "./progression-catalog";

/**
 * Segunda tanda de insignias (2026-10-13): más variedad para las cartas de
 * recompensa. Todo lo que hay aquí se mide con datos que ya existen —sesiones,
 * series, cardio, rutinas, comentarios y valoraciones—; ninguna regla depende
 * de algo que el servidor no pueda calcular.
 *
 * Reparto buscado: que casi cualquier forma de usar la app (entrenar fuerte,
 * entrenar seguido, hacer cardio, crear rutinas, participar) tenga una primera
 * insignia común cercana y una legendaria lejana.
 */

/** Color de marco por rareza: es lo que la carta usa cuando no hay otro criterio. */
const RARITY_COLOR: Record<BadgeRarity, string> = {
  COMUN: "#8a8f98",
  RARA: "#5aa9e6",
  EPICA: "#b388ff",
  LEGENDARIA: "#ffb020",
};

type Compact = readonly [
  code: string,
  name: string,
  description: string,
  flavorText: string,
  category: BadgeCategory,
  rarity: BadgeRarity,
  icon: string,
  criterionType: BadgeCriterionType,
  threshold: number,
  points: number,
];

const rows: readonly Compact[] = [
  // ─────────────────────────────────────────────────────── HITO · primeras veces
  ["PRIMERA_SUPERSERIE", "Sin respiro", "Completa tu primera superserie o circuito.", "Dos ejercicios, cero excusas entre uno y otro.", "HITO", "COMUN", "flash-outline", "SUPERSET_SESSIONS", 1, 30],
  ["PRIMER_CARDIO", "Primer sudor", "Registra tus primeros 10 minutos de cardio.", "El corazón también entrena.", "HITO", "COMUN", "walk-outline", "CARDIO_TOTAL_MINUTES", 10, 30],
  ["PRIMERA_PLANCHA", "Un minuto eterno", "Acumula 60 segundos en ejercicios por tiempo.", "Nadie sabe lo que dura un minuto hasta que hace plancha.", "HITO", "COMUN", "timer-outline", "TIMED_SECONDS_TOTAL", 60, 30],
  ["PRESENTE", "Presente", "Termina una sesión verificada en tu gimnasio.", "Estuviste ahí. Eso ya es más que la mayoría.", "HITO", "COMUN", "location-outline", "GEO_VERIFIED_SESSIONS", 1, 30],

  // ──────────────────────────────────────────────────────────────── CONSTANCIA
  ["RACHA_14", "Dos semanas seguidas", "Mantén una racha de 14 días.", "Ya no es un impulso. Es una costumbre.", "CONSTANCIA", "EPICA", "flame-outline", "STREAK_DAYS", 14, 250],
  ["RACHA_100", "Cien días", "Mantén una racha de 100 días.", "Cien días seguidos. Hay gente que no ha hecho nada cien días seguidos.", "CONSTANCIA", "LEGENDARIA", "flame", "STREAK_DAYS", 100, 800],
  ["SEMANAS_26", "Medio año sin fallar", "Entrena al menos una vez por semana durante 26 semanas seguidas.", "Seis meses apareciendo. El resto llega solo.", "CONSTANCIA", "LEGENDARIA", "calendar-outline", "WEEKLY_STREAK", 26, 600],
  ["SEMANAS_52", "Un año entero", "Entrena al menos una vez por semana durante 52 semanas seguidas.", "Un año completo. Ya no te lo quita nadie.", "CONSTANCIA", "LEGENDARIA", "calendar", "WEEKLY_STREAK", 52, 1000],
  ["SEMANA_DE_CINCO", "Semana de cinco", "Entrena 5 veces en una misma semana.", "Cinco de siete. El sofá te echó de menos.", "CONSTANCIA", "RARA", "calendar-number-outline", "MAX_SESSIONS_IN_WEEK", 5, 120],
  ["SEMANA_DE_SEIS", "Semana de seis", "Entrena 6 veces en una misma semana.", "Seis días. El séptimo, hasta Dios descansó.", "CONSTANCIA", "EPICA", "calendar-number", "MAX_SESSIONS_IN_WEEK", 6, 220],
  ["LOS_SIETE_DIAS", "Los siete días", "Entrena alguna vez en cada día de la semana.", "Lunes, martes… todos tienen ya tu firma.", "CONSTANCIA", "RARA", "grid-outline", "DISTINCT_WEEKDAYS", 7, 120],
  ["LUNES_10", "Nunca faltes un lunes", "Entrena 10 lunes.", "La semana empieza donde tú decides.", "CONSTANCIA", "COMUN", "today-outline", "MONDAY_SESSIONS", 10, 60],
  ["LUNES_40", "Dueño de los lunes", "Entrena 40 lunes.", "Cuarenta lunes. A estas alturas el lunes te tiene miedo a ti.", "CONSTANCIA", "EPICA", "today", "MONDAY_SESSIONS", 40, 300],
  ["CARA_CONOCIDA", "Cara conocida", "Termina 25 sesiones verificadas en tu gimnasio.", "Ya te saludan por tu nombre en recepción.", "CONSTANCIA", "RARA", "people-outline", "GEO_VERIFIED_SESSIONS", 25, 130],
  ["DOSCIENTAS_CINCUENTA", "Doscientas cincuenta", "Completa 250 entrenamientos.", "Doscientas cincuenta veces dijiste «hoy sí».", "CONSTANCIA", "LEGENDARIA", "infinite-outline", "SESSION_COUNT", 250, 700],
  ["DIEZ_HORAS", "Diez horas", "Acumula 10 horas de entrenamiento.", "Diez horas tuyas, de nadie más.", "CONSTANCIA", "COMUN", "hourglass-outline", "TOTAL_TRAINING_MINUTES", 600, 50],
  ["CIEN_HORAS", "Cien horas", "Acumula 100 horas de entrenamiento.", "Cien horas. Más que muchas series enteras de televisión.", "CONSTANCIA", "EPICA", "hourglass", "TOTAL_TRAINING_MINUTES", 6000, 300],
  ["QUINIENTAS_HORAS", "Quinientas horas", "Acumula 500 horas de entrenamiento.", "Tres semanas de tu vida, sin parar, entrenando.", "CONSTANCIA", "LEGENDARIA", "hourglass", "TOTAL_TRAINING_MINUTES", 30000, 900],

  // ──────────────────────────────────────────────────────────────────── FUERZA
  ["CLUB_60", "Club de los 60", "Registra una serie con 60 kg o más.", "Tres discos de veinte. O casi.", "FUERZA", "COMUN", "barbell-outline", "MAX_SET_WEIGHT_KG", 60, 50],
  ["CLUB_100", "Club de los 100", "Registra una serie con 100 kg o más.", "Tres cifras en la barra. Bienvenido.", "FUERZA", "RARA", "barbell", "MAX_SET_WEIGHT_KG", 100, 150],
  ["CLUB_140", "Club de los 140", "Registra una serie con 140 kg o más.", "Tres discos por lado. La barra ya se dobla un poco.", "FUERZA", "EPICA", "barbell", "MAX_SET_WEIGHT_KG", 140, 300],
  ["CLUB_180", "Club de los 180", "Registra una serie con 180 kg o más.", "Cuatro discos por lado. Se hace silencio en la sala.", "FUERZA", "LEGENDARIA", "barbell", "MAX_SET_WEIGHT_KG", 180, 600],
  ["VEINTICINCO_RECORDS", "Coleccionista de marcas", "Bate tu marca en 25 ejercicios distintos.", "Veinticinco veces fuiste mejor que tu versión anterior.", "FUERZA", "EPICA", "trophy-outline", "PERSONAL_RECORDS", 25, 300],
  ["CINCUENTA_RECORDS", "Sin techo", "Bate tu marca en 50 ejercicios distintos.", "Cincuenta récords. El techo era de cartón.", "FUERZA", "LEGENDARIA", "trophy", "PERSONAL_RECORDS", 50, 700],
  ["PLANCHA_10_MIN", "Diez minutos quieto", "Acumula 10 minutos en ejercicios por tiempo.", "Quieto no es lo mismo que parado.", "FUERZA", "RARA", "timer-outline", "TIMED_SECONDS_TOTAL", 600, 120],
  ["PLANCHA_60_MIN", "Una hora de hierro", "Acumula una hora en ejercicios por tiempo.", "Una hora entera sosteniendo. El core ya es de otro material.", "FUERZA", "EPICA", "timer", "TIMED_SECONDS_TOTAL", 3600, 280],
  ["SUPERSERIES_20", "Sin descanso", "Haz superseries o circuitos en 20 sesiones.", "Descansar es para cuando acabe la vuelta.", "FUERZA", "RARA", "flash", "SUPERSET_SESSIONS", 20, 140],

  // ──────────────────────────────────────────────────────────────────── CARDIO
  ["CARDIO_1H", "Primera hora de cardio", "Acumula 60 minutos de cardio.", "Una hora con el pulso arriba.", "CARDIO", "COMUN", "heart-outline", "CARDIO_TOTAL_MINUTES", 60, 50],
  ["CARDIO_10H", "Diez horas de pulso", "Acumula 10 horas de cardio.", "Diez horas. Los pulmones ya son más grandes.", "CARDIO", "RARA", "heart-half-outline", "CARDIO_TOTAL_MINUTES", 600, 150],
  ["CARDIO_50H", "Motor diésel", "Acumula 50 horas de cardio.", "Cincuenta horas. Ya no te cansas: te aburres.", "CARDIO", "EPICA", "heart", "CARDIO_TOTAL_MINUTES", 3000, 350],
  ["CARDIO_10K", "Diez kilómetros", "Recorre 10 km en total haciendo cardio.", "Diez kilómetros: de tu casa a donde no llegabas.", "CARDIO", "COMUN", "navigate-outline", "CARDIO_TOTAL_KM", 10, 50],
  ["CARDIO_42K", "Un maratón por partes", "Recorre 42,2 km en total haciendo cardio.", "Un maratón entero. A plazos, pero entero.", "CARDIO", "RARA", "map-outline", "CARDIO_TOTAL_KM", 42.2, 150],
  ["CARDIO_100K", "Cien kilómetros", "Recorre 100 km en total haciendo cardio.", "Cien kilómetros. Podrías haberte ido de la ciudad.", "CARDIO", "EPICA", "map", "CARDIO_TOTAL_KM", 100, 300],
  ["CARDIO_500K", "Quinientos kilómetros", "Recorre 500 km en total haciendo cardio.", "Quinientos. Eso ya es un viaje.", "CARDIO", "LEGENDARIA", "earth-outline", "CARDIO_TOTAL_KM", 500, 800],

  // ──────────────────────────────────────────────────────────────────── SOCIAL
  ["PRIMER_COMENTARIO", "Rompiste el hielo", "Escribe tu primer comentario.", "Alguien tenía que decirlo. Fuiste tú.", "SOCIAL", "COMUN", "chatbubble-outline", "COMMENTS_WRITTEN", 1, 25],
  ["DIEZ_COMENTARIOS", "Voz del gimnasio", "Escribe 10 comentarios.", "La gente ya sabe quién eres antes de verte entrenar.", "SOCIAL", "RARA", "chatbubbles-outline", "COMMENTS_WRITTEN", 10, 110],
  ["PRIMERA_VALORACION", "Ojo crítico", "Valora una rutina.", "Tu opinión también levanta peso.", "SOCIAL", "COMUN", "star-outline", "RATINGS_GIVEN", 1, 25],
  ["DIEZ_VALORACIONES", "Jurado", "Valora 10 rutinas.", "Diez veredictos. El catálogo es mejor gracias a ti.", "SOCIAL", "RARA", "star-half-outline", "RATINGS_GIVEN", 10, 110],
  ["CINCO_ME_GUSTA", "Te escuchan", "Recibe 5 «me gusta» en tus comentarios.", "Cinco personas pensaron «eso mismo».", "SOCIAL", "COMUN", "heart-circle-outline", "COMMENT_LIKES_RECEIVED", 5, 50],
  ["VEINTICINCO_ME_GUSTA", "Consejo de oro", "Recibe 25 «me gusta» en tus comentarios.", "Lo que dices le sirve a otros. Eso vale más que un récord.", "SOCIAL", "EPICA", "heart-circle", "COMMENT_LIKES_RECEIVED", 25, 260],

  // ─────────────────────────────────────────────────────────────────── CREADOR
  ["PRIMERA_RUTINA", "Tu primer plan", "Crea tu primera rutina.", "Entrenar con plan es entrenar dos veces.", "CREADOR", "COMUN", "create-outline", "ROUTINES_CREATED", 1, 30],
  ["TRES_RUTINAS", "Arquitecto", "Crea 3 rutinas.", "Tres planos. Ya diseñas, no improvisas.", "CREADOR", "COMUN", "construct-outline", "ROUTINES_CREATED", 3, 60],
  ["PRIMERA_PUBLICA", "A la vista de todos", "Publica una rutina.", "Hace falta valor para enseñar cómo entrenas.", "CREADOR", "RARA", "megaphone-outline", "ROUTINES_PUBLISHED", 1, 120],
  ["CINCO_DESCARGAS", "La gente la quiere", "Consigue que guarden tus rutinas 5 veces.", "Cinco personas entrenan hoy con algo que hiciste tú.", "CREADOR", "RARA", "download-outline", "ROUTINE_COPIES_RECEIVED", 5, 150],
  ["VEINTICINCO_DESCARGAS", "Rutina de culto", "Consigue que guarden tus rutinas 25 veces.", "Veinticinco copias. Tu rutina ya tiene vida propia.", "CREADOR", "EPICA", "cloud-download-outline", "ROUTINE_COPIES_RECEIVED", 25, 350],
  ["CIEN_DESCARGAS", "Leyenda del catálogo", "Consigue que guarden tus rutinas 100 veces.", "Cien personas. Eso no es una rutina: es una escuela.", "CREADOR", "LEGENDARIA", "cloud-download", "ROUTINE_COPIES_RECEIVED", 100, 900],
];

/** Empiezan en 600 para ir detrás de todo el catálogo original (que acaba en 560). */
const FIRST_SORT_ORDER = 600;

export const extendedBadgeSeeds: readonly BadgeSeed[] = rows.map(
  ([code, name, description, flavorText, category, rarity, icon, criterionType, threshold, points], index) => ({
    code,
    audience: "ANY",
    name,
    description,
    flavorText,
    category,
    rarity,
    icon,
    color: RARITY_COLOR[rarity],
    criterionType,
    criterionThreshold: threshold,
    pointsReward: points,
    secret: false,
    sortOrder: FIRST_SORT_ORDER + index * 10,
  }),
);
