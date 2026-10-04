import {
  ExerciseMediaStatus,
  ExerciseType,
  UserRole,
} from "../../common/enums/domain.enums";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { ExerciseMediaService } from "./exercise-media.service";
import { uploadExerciseMediaSchema } from "./exercises.schemas";

/**
 * Volver a subir una pieza con la misma identidad (ejercicio, variante,
 * formato, versión) pero con OTRO contenido —un recorte corregido— tiene que
 * dejar la fila apuntando al objeto nuevo. Antes se actualizaban los textos y
 * los metadatos, pero `url` y `checksum_sha256` seguían siendo los del objeto
 * viejo: la app enseñaba el vídeo anterior y cada nueva pasada volvía a subir
 * el archivo, porque el checksum de la fila nunca coincidía.
 */

const exerciseId = "d02730ac-b0cd-4cd3-8570-d3c22b5d8c0f";
const base = env.MEDIA_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, "");
const oldUrl = `${base}/ejercicios/${exerciseId}/${"a".repeat(64)}.mp4`;
const newChecksum = "b".repeat(64);
const newUrl = `${base}/ejercicios/${exerciseId}/${newChecksum}.mp4`;

const admin: AuthenticatedUser = {
  id: "admin-id",
  email: "admin@gymsheet.local",
  role: UserRole.ADMIN,
  tenantId: "tenant",
  tenantScope: "tenant",
  impersonating: false,
};

function buildService() {
  const existing = {
    exerciseId,
    isPrimary: true,
    url: oldUrl,
    checksumSha256: "a".repeat(64),
    thumbnailUrl: `${base}/ejercicios/${exerciseId}/poster.webp`,
    metadata: { variant: "HOMBRE" },
    set: jest.fn(),
    update: jest.fn((changes: Record<string, unknown>) => Promise.resolve(changes)),
  };
  const exercisesRepository = {
    findVisibleById: jest.fn().mockResolvedValue({
      id: exerciseId,
      type: ExerciseType.GLOBAL,
      createdByUserId: null,
    }),
  };
  const mediaRepository = {
    findByExternalIdentity: jest.fn().mockResolvedValue(existing),
    clearPrimary: jest.fn().mockResolvedValue(undefined),
  };
  const sequelize = {
    transaction: jest.fn((work: (transaction: unknown) => unknown) => work({})),
  };
  const storage = {
    upload: jest.fn().mockResolvedValue({
      provider: "local",
      key: `ejercicios/${exerciseId}/${newChecksum}.mp4`,
      url: newUrl,
      checksumSha256: newChecksum,
      sizeBytes: 10,
      reused: false,
    }),
  };
  const service = new ExerciseMediaService(
    exercisesRepository as never,
    mediaRepository as never,
    sequelize as never,
    storage as never,
  );
  return { service, existing };
}

describe("ExerciseMediaService.uploadMedia al volver a subir una pieza", () => {
  it("apunta la fila al objeto nuevo cuando el contenido cambió", async () => {
    const { service, existing } = buildService();

    await service.uploadMedia(
      admin,
      exerciseId,
      { originalname: "hombre.mp4", mimetype: "video/mp4", size: 10, buffer: Buffer.from("nuevo") },
      uploadExerciseMediaSchema.parse({ altText: "Demostración", variant: "HOMBRE", isPrimary: true }),
    );

    expect(existing.update).toHaveBeenCalledTimes(1);
    const changes = existing.update.mock.calls[0][0];
    expect(changes.url).toBe(newUrl);
    expect(changes.checksumSha256).toBe(newChecksum);
    expect(changes.status).toBe(ExerciseMediaStatus.ACTIVE);
  });
});
