import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "../../common/enums/domain.enums";
import { RolesGuard } from "../../common/guards/roles.guard";
import { platformScopeOf } from "../../common/tenancy/tenant-scope";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { ADMIN_PERMISSION_KEYS } from "../admin-access/admin-permission.catalog";
import { SignupAdminController } from "../antibot/signup-admin.controller";
import { RoutineAdminController } from "../training/routine-admin.controller";
import { VerificationAdminController } from "../verification/verification.controller";
import { ModerationAdminController } from "./moderation.controller";
import {
  contentHiddenNotice,
  contentRestoredNotice,
  minorClosureNotice,
  minorReviewClearedNotice,
  minorSuspensionNotice,
  sanctionNotice,
} from "./moderation-notices";
import { nextSanction } from "./moderation.policy";
import { PlatformModeratorsController } from "./platform-moderators.controller";

const principal = (role: UserRole, tenantScope: string | null = "gym-a"): AuthenticatedUser => ({
  id: "00000000-0000-4000-8000-000000000001",
  email: "someone@example.test",
  role,
  tenantId: "gym-a",
  tenantScope,
  impersonating: false,
});

/** Runs the real RolesGuard against the real metadata of a controller handler. */
function canEnter(controller: object, handler: string, user: AuthenticatedUser): boolean {
  const target = (controller as { prototype: Record<string, () => unknown> }).prototype[handler];
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => target,
    getClass: () => controller,
  } as unknown as ExecutionContext;
  try {
    return new RolesGuard(new Reflector()).canActivate(context);
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe("Platform moderation (ADR-0018)", () => {
  const moderationRoutes: [object, string][] = [
    ...["queue", "getCase", "claim", "release", "resolve", "history"].map((handler): [object, string] => [ModerationAdminController, handler]),
    [SignupAdminController, "list"],
    [RoutineAdminController, "list"],
    // The selfie review is platform work too: a selfie is biometric data the gym never sees.
    ...["queue", "selfie", "decide"].map((handler): [object, string] => [VerificationAdminController, handler]),
  ];

  it.each(moderationRoutes)("%p.%s admits MODERATOR and SYSTEM_ADMIN and refuses members and businesses", (controller, handler) => {
    expect(canEnter(controller, handler, principal(UserRole.MODERATOR))).toBe(true);
    expect(canEnter(controller, handler, principal(UserRole.SYSTEM_ADMIN, null))).toBe(true);
    for (const role of [UserRole.CLIENT, UserRole.BUSINESS]) {
      expect(canEnter(controller, handler, principal(role))).toBe(false);
    }
  });

  it("no moderation key is left in the platform console keys (the grant catalog is gone, ADR-0029)", () => {
    expect(ADMIN_PERMISSION_KEYS.filter((key) => key.startsWith("moderation:"))).toEqual([]);
  });

  it("only SYSTEM_ADMIN manages the moderators", () => {
    for (const handler of ["list", "assign", "revoke"]) {
      expect(canEnter(PlatformModeratorsController, handler, principal(UserRole.SYSTEM_ADMIN, null))).toBe(true);
      for (const role of [UserRole.MODERATOR, UserRole.CLIENT, UserRole.BUSINESS]) {
        expect(canEnter(PlatformModeratorsController, handler, principal(role))).toBe(false);
      }
    }
  });

  it("a moderator acts on every gym; everyone else keeps its own scope", () => {
    expect(platformScopeOf(principal(UserRole.MODERATOR, "gym-a"))).toBeNull();
    expect(platformScopeOf(principal(UserRole.SYSTEM_ADMIN, null))).toBeNull();
    expect(platformScopeOf(principal(UserRole.SYSTEM_ADMIN, "impersonated"))).toBe("impersonated");
    expect(platformScopeOf(principal(UserRole.CLIENT, "gym-a"))).toBe("gym-a");
  });

  it("every decision notice names the REPP moderation team and never the gym", () => {
    const target = { kind: "USER" as const, id: "u1" };
    const notices = [
      sanctionNotice(nextSanction(0), "SPAM", target),
      sanctionNotice(nextSanction(1), "ACOSO", target),
      sanctionNotice(nextSanction(9), "VIOLENCIA", target),
      contentHiddenNotice("SPAM", target, true),
      contentHiddenNotice("SPAM", target, false),
      contentRestoredNotice(target),
      minorSuspensionNotice(),
      minorClosureNotice(),
      minorReviewClearedNotice(true),
      minorReviewClearedNotice(false),
    ];
    for (const notice of notices) {
      expect(notice.body).toContain("equipo de moderación de REPP");
      expect(notice.body).not.toMatch(/gimnasio/iu);
    }
  });
});
