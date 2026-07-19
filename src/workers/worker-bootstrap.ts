import { Logger, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

export async function bootstrapWorker<T extends { run(signal: AbortSignal): Promise<void> }>(
  moduleType: Type<unknown>,
  runnerType: Type<T>,
): Promise<void> {
  const application = await NestFactory.createApplicationContext(moduleType, {
    bufferLogs: true,
  });
  const runner = application.get(runnerType);
  const controller = new AbortController();
  let stopping = false;

  const requestStop = (signalName: string) => {
    if (stopping) return;
    stopping = true;
    Logger.log({ event: 'worker.shutdown_requested', signalName }, 'WorkerBootstrap');
    controller.abort();
  };

  process.once('SIGTERM', () => requestStop('SIGTERM'));
  process.once('SIGINT', () => requestStop('SIGINT'));

  try {
    await runner.run(controller.signal);
  } finally {
    await application.close();
  }
}

export function reportWorkerBootstrapError(error: unknown): void {
  Logger.error(
    {
      event: 'worker.bootstrap_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    },
    error instanceof Error ? error.stack : undefined,
    'WorkerBootstrap',
  );
  process.exitCode = 1;
}
