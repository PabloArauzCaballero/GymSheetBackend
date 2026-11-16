import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { basename } from "path";
import { UserRole } from "../common/enums/domain.enums";
import { AuthenticatedUser } from "../common/types/auth-context.types";
import { env } from "../config/env";
import { UsersRepository } from "../modules/users/users.repository";

/**
 * Piezas comunes a los comandos que cargan demostraciones de ejercicio
 * (`db:media:ejercicios` y `db:import:biblioteca`). Viven aquí para que los dos
 * comprueben ffprobe y resuelvan la cuenta administradora exactamente igual.
 */

/** `--flag=valor` o `--flag valor`, como el resto de comandos del repo. */
export function readFlag(
  argv: readonly string[],
  name: string,
): string | undefined {
  const withEquals = argv.find((argument) => argument.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) {
    return argv[index + 1];
  }
  return undefined;
}

/** ¿Está `ffprobe` disponible? Sin él no se puede garantizar la especificación. */
export function hasFfprobe(): boolean {
  const probe = spawnSync("ffprobe", ["-version"], { encoding: "utf8" });
  return !probe.error && probe.status === 0;
}

export function probeVideo(filePath: string): unknown {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames",
      "-show_entries",
      "format=duration,size",
      "-of",
      "json",
      filePath,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (probe.status !== 0) {
    throw new Error(
      `ffprobe falló sobre ${basename(filePath)}: ${probe.stderr.trim()}`,
    );
  }
  return JSON.parse(probe.stdout) as unknown;
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * The account the global catalog demonstrations are registered with: the
 * platform `SYSTEM_ADMIN` of `SEED_ADMIN_EMAIL`. Only REPP manages global
 * exercises (ADR-0019), and the media service checks it with this actor,
 * which acts on every gym (no impersonation, null scope).
 */
export async function resolveAdministratorActor(
  usersRepository: UsersRepository,
): Promise<AuthenticatedUser> {
  const administratorEmail = env.SEED_ADMIN_EMAIL;
  if (!administratorEmail) {
    throw new Error(
      "Falta SEED_ADMIN_EMAIL: el comando necesita saber con qué cuenta " +
        "administradora se registran las demostraciones.",
    );
  }
  const administrator =
    await usersRepository.findActiveByEmail(administratorEmail);
  if (!administrator || administrator.role !== UserRole.SYSTEM_ADMIN) {
    throw new Error(
      `No hay un administrador de plataforma activo con el correo ${administratorEmail}; ` +
        "el catálogo global solo lo puede gestionar un SYSTEM_ADMIN.",
    );
  }
  return {
    id: administrator.id,
    email: administrator.email,
    role: administrator.role,
    tenantId: administrator.tenantId ?? env.DEFAULT_TENANT_ID,
    tenantScope: null,
    impersonating: false,
  };
}
