import { TrainingGoal } from '../../common/enums/domain.enums';
import { AnthropometricProfileModel } from './anthropometric-profile.model';

export type AnthropometricProfileResponse = {
  id: string;
  usuarioId: string;
  edad: number;
  pesoKg: number;
  estaturaCm: number;
  objetivo: TrainingGoal;
  fechaActualizacion: Date;
};

/** Maps an ORM profile to the established v1 response without exposing internals. */
export function mapProfileToResponse(
  profile: AnthropometricProfileModel,
): AnthropometricProfileResponse {
  return {
    id: profile.id,
    usuarioId: profile.userId,
    edad: profile.age,
    pesoKg: Number(profile.weightKg),
    estaturaCm: profile.heightCm,
    objetivo: profile.goal,
    fechaActualizacion: profile.measurementUpdatedAt,
  };
}
