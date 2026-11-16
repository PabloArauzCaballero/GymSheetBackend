import { reporterFacingStatus } from "./moderation.policy";
import { MyReportRow } from "./my-reports.repository";

/** «Tus denuncias» item. `details` and moderation internals are not echoed back. */
export function toMyReportDto(row: MyReportRow) {
  return {
    id: row.id,
    targetKind: row.targetKind,
    targetId: row.targetId,
    title: row.title,
    ownerName: row.ownerName,
    reason: row.reason,
    status: reporterFacingStatus(row.status),
    createdAt: row.createdAt,
  };
}
