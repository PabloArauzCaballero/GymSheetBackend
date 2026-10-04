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
 * La cuenta con la que se registran las demostraciones del catálogo global:
 * el ADMIN de `SEED_ADMIN_EMAIL`. Solo un ADMIN puede gestionar ejercicios
 * globales, y el servicio de media lo comprueba con este actor.
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
  if (!administrator || administrator.role !== UserRole.ADMIN) {
    throw new Error(
      `No hay un administrador activo con el correo ${administratorEmail}; ` +
        "el catálogo global solo lo puede gestionar un ADMIN.",
    );
  }
  return {
    id: administrator.id,
    email: administrator.email,
    role: administrator.role,
    tenantId: administrator.tenantId ?? env.DEFAULT_TENANT_ID,
    tenantScope: administrator.tenantId ?? env.DEFAULT_TENANT_ID,
    impersonating: false,
  };
}
