import type { Request } from "express";
import { UserRole } from "../../common/enums/domain.enums";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { AuditLogService } from "../admin-access/audit-log.service";
import { VerificationAdminController } from "./verification.controller";
import { VerificationReviewService } from "./verification-review.service";

const actor: AuthenticatedUser = {
  id: "00000000-0000-4000-8000-0000000000ff",
  email: "mod@example.test",
  role: UserRole.MODERATOR,
  tenantId: "gym-a",
  tenantScope: "gym-a",
  impersonating: false,
};
const verificationId = "00000000-0000-4000-8000-0000000000aa";
const request = { ip: "10.0.0.1", get: () => "jest-agent" } as unknown as Request;

describe("VerificationAdminController.decide (ADR-0018 audit)", () => {
  function setup(decide: jest.Mock) {
    const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new VerificationAdminController(
      { decide } as unknown as VerificationReviewService,
      auditLog as unknown as AuditLogService,
    );
    return { controller, auditLog };
  }

  it("audits the decision under `verification` with the member's gym and the decision, after it committed", async () => {
    const submission = { id: verificationId, status: "REJECTED" as const, submittedAt: null };
    const { controller, auditLog } = setup(
      jest.fn().mockResolvedValue({ submission, tenantId: "gym-b", decision: "REJECTED", reason: "LOW_QUALITY" }),
    );
    await expect(controller.decide(actor, verificationId, { decision: "REJECT", reason: "LOW_QUALITY" }, request))
      .resolves.toEqual(submission);
    expect(auditLog.record).toHaveBeenCalledWith(actor, {
      domain: "verification",
      action: "decide",
      targetKind: "photo_verification",
      targetId: verificationId,
      metadata: { tenantId: "gym-b", decision: "REJECTED", reason: "LOW_QUALITY" },
      ip: "10.0.0.1",
      userAgent: "jest-agent",
    });
  });

  it("writes nothing when the decision fails", async () => {
    const { controller, auditLog } = setup(jest.fn().mockRejectedValue(new Error("conflict")));
    await expect(controller.decide(actor, verificationId, { decision: "REJECT", reason: "OTHER" }, request)).rejects.toThrow("conflict");
    expect(auditLog.record).not.toHaveBeenCalled();
  });
});
