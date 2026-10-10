import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { ProgramWeekCloseService } from '../modules/programs/program-week-close.service';
import { sleep } from './worker-loop';

/**
 * Cierre semanal de programas: cada pasada cierra las semanas vencidas, paga
 * los bonos de modo y termina los programas que acabaron. Si el proceso estuvo
 * caído un lunes, la pasada siguiente recupera todas las semanas pendientes.
 */
@Injectable()
export class ProgramWeekCloseRunner {
  private readonly logger = new Logger(ProgramWeekCloseRunner.name);

  constructor(private readonly close: ProgramWeekCloseService) {}

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log({ event: 'worker.started', worker: 'programs-week-close' });
    while (!signal.aborted) {
      try {
        const closed = await this.close.closeDueWeeks();
        if (closed.length > 0) {
          this.logger.log({
            event: 'program_week_close.batch_completed',
            weeks: closed.length,
            fulfilled: closed.filter((c) => c.fulfilled === true).length,
            bonusPoints: closed.reduce((sum, c) => sum + c.bonus, 0),
          });
        }
      } catch (error: unknown) {
        this.logger.error({
          event: 'program_week_close.scan_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      await sleep(env.PROGRAM_WEEK_CLOSE_INTERVAL_MS, signal);
    }
    this.logger.log({ event: 'worker.stopped', worker: 'programs-week-close' });
  }
}
