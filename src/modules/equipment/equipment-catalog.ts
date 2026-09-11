import { EquipmentType } from "../../common/enums/domain.enums";

/**
 * El equipamiento que casi todo gimnasio tiene.
 *
 * Existe para una sola cosa: que dar de alta un gimnasio nuevo no empiece con
 * un formulario vacío. Sin esto, quien abre su sede tiene que escribir a mano
 * sesenta fichas antes de que la aplicación le sirva de algo, y lo que ocurre
 * en la práctica es que escribe cuatro y abandona —o peor, escribe «Prensa»,
 * «prensa de piernas» y «Leg press» en tres visitas distintas y los informes
 * quedan repartidos entre tres máquinas que son la misma—.
 *
 * Es un catálogo **sugerido**, no un modelo cerrado: se copia a la sede al
 * darla de alta y a partir de ahí cada gimnasio edita, borra y añade lo suyo.
 * Nadie hereda una máquina que no tiene.
 *
 * Los nombres están en el español que se usa en el gimnasio, no en catálogo de
 * fabricante: quien marca las casillas es el dueño, y va a buscar «prensa de
 * piernas», no «leg press 45°».
 *
 * `clave` es lo que hace posible reconocer la misma máquina entre sedes: dos
 * gimnasios que marcan `press-banca` tienen la misma, aunque uno la renombre
 * después. Es lo que permitirá algún día comparar uso entre sedes; sin ella,
 * cada sede sería un universo con sus propios nombres.
 */
export interface CatalogEquipment {
  readonly clave: string;
  readonly nombre: string;
  readonly tipo: EquipmentType;
  /** Agrupación con la que se presenta al elegir; no es un dato del dominio. */
  readonly zona: string;
}

export const equipmentCatalog: readonly CatalogEquipment[] = [
  // Peso libre — lo primero que tiene un gimnasio y lo último que le falta.
  { clave: "barra-olimpica", nombre: "Barra olímpica", tipo: EquipmentType.BARBELL, zona: "Peso libre" },
  { clave: "barra-z", nombre: "Barra Z", tipo: EquipmentType.BARBELL, zona: "Peso libre" },
  { clave: "mancuernas", nombre: "Mancuernas", tipo: EquipmentType.DUMBBELL, zona: "Peso libre" },
  { clave: "discos", nombre: "Discos", tipo: EquipmentType.PLATE, zona: "Peso libre" },
  { clave: "kettlebell", nombre: "Pesas rusas", tipo: EquipmentType.DUMBBELL, zona: "Peso libre" },
  { clave: "rack-sentadilla", nombre: "Rack de sentadilla", tipo: EquipmentType.MACHINE, zona: "Peso libre" },
  { clave: "jaula-potencia", nombre: "Jaula de potencia", tipo: EquipmentType.MACHINE, zona: "Peso libre" },
  { clave: "banco-plano", nombre: "Banco plano", tipo: EquipmentType.BENCH, zona: "Peso libre" },
  { clave: "banco-inclinado", nombre: "Banco inclinado", tipo: EquipmentType.BENCH, zona: "Peso libre" },
  { clave: "banco-declinado", nombre: "Banco declinado", tipo: EquipmentType.BENCH, zona: "Peso libre" },

  // Máquinas de empuje.
  { clave: "press-banca", nombre: "Press de banca (máquina)", tipo: EquipmentType.MACHINE, zona: "Empuje" },
  { clave: "press-pecho", nombre: "Press de pecho", tipo: EquipmentType.MACHINE, zona: "Empuje" },
  { clave: "press-hombro", nombre: "Press de hombro", tipo: EquipmentType.MACHINE, zona: "Empuje" },
  { clave: "peck-deck", nombre: "Contractor de pecho (peck deck)", tipo: EquipmentType.MACHINE, zona: "Empuje" },
  { clave: "fondos-asistidos", nombre: "Fondos asistidos", tipo: EquipmentType.MACHINE, zona: "Empuje" },

  // Máquinas de tirón.
  { clave: "jalon-polea-alta", nombre: "Jalón en polea alta", tipo: EquipmentType.CABLE, zona: "Tirón" },
  { clave: "remo-sentado", nombre: "Remo sentado en polea", tipo: EquipmentType.CABLE, zona: "Tirón" },
  { clave: "remo-maquina", nombre: "Remo en máquina", tipo: EquipmentType.MACHINE, zona: "Tirón" },
  { clave: "dominadas-asistidas", nombre: "Dominadas asistidas", tipo: EquipmentType.MACHINE, zona: "Tirón" },
  { clave: "barra-dominadas", nombre: "Barra de dominadas", tipo: EquipmentType.ACCESSORY, zona: "Tirón" },
  { clave: "polea-doble", nombre: "Polea doble / crossover", tipo: EquipmentType.CABLE, zona: "Tirón" },

  // Pierna.
  { clave: "prensa-piernas", nombre: "Prensa de piernas", tipo: EquipmentType.MACHINE, zona: "Pierna" },
  { clave: "extension-cuadriceps", nombre: "Extensión de cuádriceps", tipo: EquipmentType.MACHINE, zona: "Pierna" },
  { clave: "curl-femoral", nombre: "Curl femoral", tipo: EquipmentType.MACHINE, zona: "Pierna" },
  { clave: "hack-squat", nombre: "Hack squat", tipo: EquipmentType.MACHINE, zona: "Pierna" },
  { clave: "gemelos", nombre: "Máquina de gemelos", tipo: EquipmentType.MACHINE, zona: "Pierna" },
  { clave: "abductores", nombre: "Abductores / aductores", tipo: EquipmentType.MACHINE, zona: "Pierna" },
  { clave: "hip-thrust", nombre: "Hip thrust", tipo: EquipmentType.MACHINE, zona: "Pierna" },

  // Cardio.
  { clave: "cinta", nombre: "Cinta de correr", tipo: EquipmentType.MACHINE, zona: "Cardio" },
  { clave: "eliptica", nombre: "Elíptica", tipo: EquipmentType.MACHINE, zona: "Cardio" },
  { clave: "bicicleta-estatica", nombre: "Bicicleta estática", tipo: EquipmentType.MACHINE, zona: "Cardio" },
  { clave: "remo-cardio", nombre: "Remo de cardio", tipo: EquipmentType.MACHINE, zona: "Cardio" },
  { clave: "escaladora", nombre: "Escaladora", tipo: EquipmentType.MACHINE, zona: "Cardio" },

  // Accesorios y funcional.
  { clave: "bandas", nombre: "Bandas elásticas", tipo: EquipmentType.BAND, zona: "Funcional" },
  { clave: "trx", nombre: "Entrenamiento en suspensión (TRX)", tipo: EquipmentType.ACCESSORY, zona: "Funcional" },
  { clave: "cajon-pliometrico", nombre: "Cajón pliométrico", tipo: EquipmentType.ACCESSORY, zona: "Funcional" },
  { clave: "balon-medicinal", nombre: "Balón medicinal", tipo: EquipmentType.ACCESSORY, zona: "Funcional" },
  { clave: "colchoneta", nombre: "Colchonetas", tipo: EquipmentType.ACCESSORY, zona: "Funcional" },
  { clave: "cuerda-batida", nombre: "Cuerdas de batida", tipo: EquipmentType.ACCESSORY, zona: "Funcional" },
];

/** Zonas en el orden en que se presentan al elegir. */
export const equipmentCatalogZones: readonly string[] = [
  "Peso libre",
  "Empuje",
  "Tirón",
  "Pierna",
  "Cardio",
  "Funcional",
];
