import { Injectable, NotFoundException } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { EquipmentType } from "../../common/enums/domain.enums";

/**
 * Deduce con qué se entrena un músculo.
 *
 * Al crear un ejercicio propio, la persona elige el músculo y el equipamiento
 * se resuelve solo. La deducción **no está escrita a mano**: sale del catálogo
 * real. Se cuenta con qué se entrena ese músculo en los ejercicios que ya
 * existen y gana lo más frecuente.
 *
 * Se hizo así, y no con una tabla músculo→máquina, por dos motivos. Uno, esa
 * tabla sería una opinión: nadie puede decir que el dorsal «es» de polea. Dos,
 * quedaría congelada — el catálogo se sincroniza con un dataset externo que
 * crece, y una tabla fija envejecería en silencio mientras los datos cambian.
 *
 * Cuando el músculo no tiene ejercicios catalogados —un catálogo recién
 * instalado, o uno sin enriquecer— no se inventa nada: se responde que no hay
 * sugerencia y el formulario deja elegir a mano.
 */
export interface EquipmentSuggestion {
  /** Etiqueta cruda del catálogo, tal cual la usa el dataset (`cable`, `barbell`…). */
  readonly label: string;
  /** Nombre legible en castellano. */
  readonly name: string;
  /** Familia de equipamiento del dominio. */
  readonly type: EquipmentType;
  /** Ejercicios del catálogo que lo usan para ese músculo. */
  readonly exerciseCount: number;
  /** Peso relativo frente al resto de opciones del mismo músculo, de 0 a 1. */
  readonly share: number;
}

export interface MuscleEquipmentInference {
  readonly muscleCode: string;
  readonly muscleName: string;
  readonly muscleGroupCode: string;
  readonly muscleGroupName: string;
  /** La opción más frecuente. Nulo si el músculo no tiene ejercicios catalogados. */
  readonly primary: EquipmentSuggestion | null;
  /** El resto, de más a menos frecuente. */
  readonly alternatives: readonly EquipmentSuggestion[];
  /** Nombre de ejercicio propuesto, listo para editar. */
  readonly suggestedName: string | null;
}

interface EquipmentCountRow {
  label: string;
  exercise_count: string;
}

interface MuscleRow {
  code: string;
  name: string;
  group_code: string;
  group_name: string;
}

/**
 * Traducción de las etiquetas del dataset abierto a familia y nombre legible.
 *
 * Solo contiene etiquetas **observadas en los datos**; no se anticipan valores
 * que nadie ha visto. Una etiqueta desconocida no rompe nada: se muestra tal
 * cual y se clasifica como `OTRO`, que es información honesta y no un error.
 */
const EQUIPMENT_LABELS: Readonly<
  Record<string, { readonly name: string; readonly type: EquipmentType }>
> = {
  "body weight": { name: "Peso corporal", type: EquipmentType.OTHER },
  dumbbell: { name: "Mancuernas", type: EquipmentType.DUMBBELL },
  barbell: { name: "Barra", type: EquipmentType.BARBELL },
  "ez barbell": { name: "Barra Z", type: EquipmentType.BARBELL },
  "olympic barbell": { name: "Barra olímpica", type: EquipmentType.BARBELL },
  "trap bar": { name: "Barra hexagonal", type: EquipmentType.BARBELL },
  cable: { name: "Polea", type: EquipmentType.CABLE },
  "leverage machine": { name: "Máquina de palanca", type: EquipmentType.MACHINE },
  "smith machine": { name: "Máquina Smith", type: EquipmentType.MACHINE },
  "sled machine": { name: "Máquina de empuje", type: EquipmentType.MACHINE },
  "hammer": { name: "Máquina Hammer", type: EquipmentType.MACHINE },
  assisted: { name: "Máquina asistida", type: EquipmentType.MACHINE },
  band: { name: "Banda elástica", type: EquipmentType.BAND },
  "resistance band": { name: "Banda de resistencia", type: EquipmentType.BAND },
  kettlebell: { name: "Kettlebell", type: EquipmentType.ACCESSORY },
  "medicine ball": { name: "Balón medicinal", type: EquipmentType.ACCESSORY },
  "stability ball": { name: "Fitball", type: EquipmentType.ACCESSORY },
  "bosu ball": { name: "Bosu", type: EquipmentType.ACCESSORY },
  rope: { name: "Cuerda", type: EquipmentType.ACCESSORY },
  roller: { name: "Rueda abdominal", type: EquipmentType.ACCESSORY },
  "wheel roller": { name: "Rueda abdominal", type: EquipmentType.ACCESSORY },
  weighted: { name: "Lastre", type: EquipmentType.PLATE },
  "skierg machine": { name: "SkiErg", type: EquipmentType.MACHINE },
  "stationary bike": { name: "Bicicleta estática", type: EquipmentType.MACHINE },
  "elliptical machine": { name: "Elíptica", type: EquipmentType.MACHINE },
  "stepmill machine": { name: "Escaladora", type: EquipmentType.MACHINE },
  "upper body ergometer": { name: "Ergómetro de brazos", type: EquipmentType.MACHINE },
  tire: { name: "Neumático", type: EquipmentType.OTHER },
};

@Injectable()
export class EquipmentInferenceService {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * Equipamiento habitual de un músculo, deducido del catálogo.
   *
   * Se mira solo el rol `PRIMARY`: un ejercicio en el que un músculo participa
   * como secundario no dice con qué se entrena ese músculo, dice con qué se
   * entrena otro.
   */
  async inferForMuscle(rawMuscleCode: string): Promise<MuscleEquipmentInference> {
    const muscleCode = rawMuscleCode.trim().toUpperCase();

    const [muscle] = await this.sequelize.query<MuscleRow>(
      `SELECT m.code, m.name, g.code AS group_code, g.name AS group_name
         FROM training.muscles m
         JOIN training.muscle_groups g ON g.id = m.muscle_group_id
        WHERE m.code = :muscleCode`,
      { type: QueryTypes.SELECT, replacements: { muscleCode } },
    );

    if (!muscle) {
      throw new NotFoundException("Músculo no encontrado en la taxonomía.");
    }

    const rows = await this.sequelize.query<EquipmentCountRow>(
      `SELECT lower(trim(e.required_equipment)) AS label,
              COUNT(*)::text AS exercise_count
         FROM public.ejercicios e
         JOIN training.exercise_muscles em ON em.ejercicio_id = e.id
         JOIN training.muscles m ON m.id = em.muscle_id
        WHERE m.code = :muscleCode
          AND em.role = 'PRIMARY'
          AND e.estado = 'ACTIVO'
          AND e.required_equipment IS NOT NULL
          AND trim(e.required_equipment) <> ''
        GROUP BY 1
        ORDER BY COUNT(*) DESC, 1 ASC
        LIMIT 8`,
      { type: QueryTypes.SELECT, replacements: { muscleCode } },
    );

    const total = rows.reduce((sum, row) => sum + Number(row.exercise_count), 0);
    const suggestions = rows.map((row) => toSuggestion(row, total));

    // El peso corporal es la etiqueta más frecuente en casi todos los músculos
    // —el catálogo abierto está lleno de calistenia— y sin esta regla sería la
    // respuesta para todo. Pero no es equipamiento: es su ausencia, y proponerla
    // como «la máquina» de un ejercicio de gimnasio no responde a la pregunta.
    // Sigue estando disponible entre las alternativas para quien la quiera.
    const equipped = suggestions.filter((option) => !isBodyweight(option.label));
    const primary = equipped[0] ?? suggestions[0] ?? null;
    const alternatives = suggestions.filter((option) => option !== primary);

    return {
      muscleCode: muscle.code,
      muscleName: muscle.name,
      muscleGroupCode: muscle.group_code,
      muscleGroupName: muscle.group_name,
      primary,
      alternatives,
      suggestedName: primary ? `${primary.name} para ${muscle.name.toLowerCase()}` : null,
    };
  }
}

/** Etiquetas del catálogo que significan «sin equipamiento». */
function isBodyweight(label: string): boolean {
  return label === "body weight" || label === "assisted";
}

function toSuggestion(row: EquipmentCountRow, total: number): EquipmentSuggestion {
  const known = EQUIPMENT_LABELS[row.label];
  const exerciseCount = Number(row.exercise_count);
  return {
    label: row.label,
    name: known?.name ?? capitalize(row.label),
    type: known?.type ?? EquipmentType.OTHER,
    exerciseCount,
    share: total > 0 ? exerciseCount / total : 0,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
