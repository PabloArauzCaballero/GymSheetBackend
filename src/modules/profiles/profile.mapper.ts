import { TrainingGoal } from "../../common/enums/domain.enums";
import { AnthropometricProfileModel } from "./anthropometric-profile.model";
import { ageFromBirthDate } from "./birth-date";

export type AnthropometricProfileResponse = {
  id: string;
  usuarioId: string;
  /** Derived from the account birth date; null when the account has none. */
  edad: number | null;
  /** `YYYY-MM-DD` or null, read from `usuarios.fecha_nacimiento`. */
  fechaNacimiento: string | null;
  pesoKg: number;
  estaturaCm: number;
  objetivo: TrainingGoal;
  fechaActualizacion: Date;
};

/** Maps an ORM profile (with its account birth date) to the v1 response without exposing internals. */
export function mapProfileToResponse(
  profile: AnthropometricProfileModel,
  birthDate: string | null,
): AnthropometricProfileResponse {
  return {
    id: profile.id,
    usuarioId: profile.userId,
    edad: birthDate ? ageFromBirthDate(birthDate) : null,
    fechaNacimiento: birthDate,
    pesoKg: Number(profile.weightKg),
    estaturaCm: profile.heightCm,
    objetivo: profile.goal,
    fechaActualizacion: profile.measurementUpdatedAt,
  };
}
