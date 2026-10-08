import { Injectable, Logger } from '@nestjs/common';
import { WorkoutSessionModel } from './workout-session.model';

export type SessionFinishedContext = {
  session: WorkoutSessionModel;
  userId: string;
  tenantId: string;
};

/** Devuelve campos extra para la respuesta de `finish`, o `null` si no aplica. */
export type SessionFinishedHook = (
  context: SessionFinishedContext,
) => Promise<Record<string, unknown> | null>;

/**
 * Punto de enganche al terminar una sesión. Otros módulos (programas) se
 * registran aquí en vez de que `workouts` los importe: así `workouts` no
 * depende de ellos. Un fallo de un enganche NUNCA pierde la sesión: se
 * registra y se sigue (igual que el premio de la Senda).
 */
@Injectable()
export class SessionHooksRegistry {
  private readonly logger = new Logger(SessionHooksRegistry.name);
  private readonly hooks: Array<{ name: string; run: SessionFinishedHook }> = [];

  register(name: string, run: SessionFinishedHook): void {
    this.hooks.push({ name, run });
  }

  async runFinished(context: SessionFinishedContext): Promise<Record<string, unknown>> {
    const extras: Record<string, unknown> = {};
    for (const hook of this.hooks) {
      try {
        Object.assign(extras, (await hook.run(context)) ?? {});
      } catch (error: unknown) {
        this.logger.warn({
          event: 'workouts.session_hook_failed',
          hook: hook.name,
          sessionId: context.session.id,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return extras;
  }
}
