import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import type { MediaReferencesRepository } from "../media/media-references.repository";
import type { MediaReleaseService } from "../media/media-release.service";
import { REPORT_EVIDENCE_RETENTION_DAYS } from "../moderation/moderation.policy";
import { ACCOUNT_CLOSURE_STEPS } from "./account-closure.catalog";
import { ReportedContentRetentionService } from "./reported-content-retention.service";
import { REPORTED_CONTENT_RETENTION_STEPS, reportedContentBatchSql } from "./reported-content-retention.steps";

const transaction = { id: "tx" } as unknown as Transaction;
const now = new Date("2026-11-16T00:00:00.000Z");

function setup(rowsPerCall: (sql: string, call: number) => { id: string; storageKey: string | null; provider: string | null }[]) {
  let call = 0;
  const query = jest.fn((sql: string) => Promise.resolve(rowsPerCall(sql, call++)));
  const sequelize = {
    query,
    transaction: jest.fn((work: (t: Transaction) => Promise<unknown>) => work(transaction)),
  } as unknown as Sequelize;
  const references = { isReferenced: jest.fn((key: string) => Promise.resolve(key === "shared.jpg")) };
  const mediaRelease = { requestRelease: jest.fn().mockResolvedValue(undefined) };
  const service = new ReportedContentRetentionService(
    sequelize,
    references as unknown as MediaReferencesRepository,
    mediaRelease as unknown as MediaReleaseService,
  );
  return { service, query, mediaRelease };
}

describe("ReportedContentRetentionService", () => {
  it("erases with a cutoff of the shared report evidence retention (180 days)", async () => {
    const { service, query } = setup(() => []);

    await service.purge(now);

    expect(REPORT_EVIDENCE_RETENTION_DAYS).toBe(180);
    const replacements = (query.mock.calls[0] as unknown as [string, { replacements: { resolvedBefore: Date } }])[1].replacements;
    expect(replacements.resolvedBefore).toEqual(new Date("2026-05-20T00:00:00.000Z"));
    expect(query).toHaveBeenCalledTimes(REPORTED_CONTENT_RETENTION_STEPS.length);
  });

  it("releases each erased file in the batch transaction, except keys still referenced", async () => {
    const { service, mediaRelease } = setup((sql, call) =>
      call === 0
        ? [
            { id: "p1", storageKey: "own.jpg", provider: null },
            { id: "p2", storageKey: "shared.jpg", provider: null },
            { id: "p3", storageKey: null, provider: null },
          ]
        : sql.includes("chat.messages") ? [{ id: "m1", storageKey: "chat.bin", provider: "local" }] : [],
    );

    const erased = await service.purge(now);

    expect(erased).toMatchObject({ PROFILE_PHOTO: 3, CHAT_MESSAGE: 1, REEL: 0 });
    expect(mediaRelease.requestRelease.mock.calls).toEqual([
      [{ aggregateType: "moderation.reported_content", aggregateId: "p1", storageKey: "own.jpg" }, transaction],
      [{ aggregateType: "moderation.reported_content", aggregateId: "m1", storageKey: "chat.bin", provider: "local" }, transaction],
    ]);
  });

  it("drains full batches before moving to the next step", async () => {
    const full = Array.from({ length: 200 }, (_, index) => ({ id: `r${index}`, storageKey: null, provider: null }));
    const { service, query } = setup((_sql, call) => (call === 0 ? full : []));

    const erased = await service.purge(now);

    expect(erased.PROFILE_PHOTO).toBe(200);
    expect(query).toHaveBeenCalledTimes(REPORTED_CONTENT_RETENTION_STEPS.length + 1);
  });
});

describe("REPORTED_CONTENT_RETENTION_STEPS", () => {
  it("covers every table the closure keeps because it was reported (stories go with the stories purge)", () => {
    const kept = ACCOUNT_CLOSURE_STEPS.filter((step) => step.disposition === "KEPT" && step.where.includes("moderation.reports r"))
      .map((step) => step.table)
      .filter((table) => table !== "profile.stories");
    expect(new Set(REPORTED_CONTENT_RETENTION_STEPS.map((step) => step.table))).toEqual(new Set(kept));
  });

  it("only touches rows of closed accounts whose reports are all closed before the cutoff", () => {
    for (const step of REPORTED_CONTENT_RETENTION_STEPS) {
      const sql = reportedContentBatchSql(step);
      expect(sql).toContain("u.closed_at IS NOT NULL");
      expect(sql).toContain(`r.target_kind = '${step.kind}'`);
      expect(sql).toContain("r.status IN ('PENDIENTE', 'EN_REVISION')");
      expect(sql).toContain("r.resolved_at > :resolvedBefore");
      expect(sql).toContain("SKIP LOCKED");
    }
  });

  it("also erases what its author deleted under an open report (evidence hold), whoever owns it", () => {
    const held = (table: string) =>
      REPORTED_CONTENT_RETENTION_STEPS.filter((step) => step.table === table).map((step) => reportedContentBatchSql(step));
    for (const sql of held("profile.photos")) expect(sql).toContain("OR t.author_deleted_at IS NOT NULL");
    for (const sql of held("community.content_comments")) expect(sql).toContain("OR t.estado = 'BORRADO_AUTOR'");
    for (const table of ["social.reels", "community.music_playlists", "chat.messages"]) {
      for (const sql of held(table)) expect(sql).not.toContain(" OR t.");
    }
  });
});
