import { env } from "../config/env";
import {
  StoriesPurgeResult,
  StoriesPurgeService,
} from "../modules/stories/stories-purge.service";
import { StoriesPurgeRunner } from "./stories-purge.runner";

function createRunner(
  purgeExpired: jest.Mock<Promise<StoriesPurgeResult>, [number, Date?]>,
) {
  return new StoriesPurgeRunner({
    purgeExpired,
  } as unknown as StoriesPurgeService);
}

const emptyPass: StoriesPurgeResult = {
  examined: 0,
  deleted: 0,
  filesRemoved: 0,
  failed: 0,
};

describe("StoriesPurgeRunner", () => {
  it("purges with the configured batch size and stops on abort", async () => {
    const controller = new AbortController();
    const purgeExpired = jest
      .fn<Promise<StoriesPurgeResult>, [number, Date?]>()
      .mockImplementationOnce(async () => {
        controller.abort();
        return emptyPass;
      });

    await createRunner(purgeExpired).run(controller.signal);

    expect(purgeExpired).toHaveBeenCalledTimes(1);
    expect(purgeExpired).toHaveBeenCalledWith(env.STORIES_PURGE_BATCH_SIZE);
  });

  it("keeps draining while a full batch still makes progress", async () => {
    const controller = new AbortController();
    const fullBatch: StoriesPurgeResult = {
      examined: env.STORIES_PURGE_BATCH_SIZE,
      deleted: env.STORIES_PURGE_BATCH_SIZE,
      filesRemoved: env.STORIES_PURGE_BATCH_SIZE,
      failed: 0,
    };
    const purgeExpired = jest
      .fn<Promise<StoriesPurgeResult>, [number, Date?]>()
      .mockResolvedValueOnce(fullBatch)
      .mockImplementationOnce(async () => {
        controller.abort();
        return emptyPass;
      });

    await createRunner(purgeExpired).run(controller.signal);

    // La segunda pasada llega sin esperar el intervalo: el lote lleno indica
    // atraso acumulado.
    expect(purgeExpired).toHaveBeenCalledTimes(2);
  });

  it("survives a failing pass instead of killing the worker", async () => {
    const controller = new AbortController();
    const purgeExpired = jest
      .fn<Promise<StoriesPurgeResult>, [number, Date?]>()
      .mockImplementationOnce(() => {
        controller.abort();
        return Promise.reject(new Error("database unreachable"));
      });

    await expect(
      createRunner(purgeExpired).run(controller.signal),
    ).resolves.toBeUndefined();
  });
});
