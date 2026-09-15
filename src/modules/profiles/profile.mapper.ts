import { TrainingGoal } from "../../common/enums/domain.enums";
import { AnthropometricProfileModel } from "./anthropometric-profile.model";
import { ageFromBirthDate } from "./birth-date";

export type AnthropometricProfileResponse = {
  id: string;
  usuarioId: string;
  /** Calculada desde `fechaNacimiento` si existe; si no, la edad guardada. */
  edad: number | null;
  /** `YYYY-MM-DD` o nulo. */
  fechaNacimiento: string | null;
  pesoKg: number;
  estaturaCm: number;
  objetivo: TrainingGoal;
  fechaActualizacion: Date;
};

/** Maps an ORM profile to the established v1 response without exposing internals. */
export function mapProfileToResponse(
  profile: AnthropometricProfileModel,
): AnthropometricProfileResponse {
  const birthDate = profile.birthDate ?? null;
  return {
    id: profile.id,
    usuarioId: profile.userId,
    edad: birthDate ? ageFromBirthDate(birthDate) : profile.age,
    fechaNacimiento: birthDate,
    pesoKg: Number(profile.weightKg),
    estaturaCm: profile.heightCm,
    objetivo: profile.goal,
    fechaActualizacion: profile.measurementUpdatedAt,
  };
}
