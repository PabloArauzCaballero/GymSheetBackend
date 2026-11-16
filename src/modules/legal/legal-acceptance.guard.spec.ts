import { ExecutionContext, HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_ROUTE_KEY } from "../../common/decorators/public.decorator";
import { DomainException } from "../../common/errors/domain.exception";
import { LegalAcceptanceGuard, isExemptPath } from "./legal-acceptance.guard";
import { LegalService } from "./legal.service";
import { SKIP_LEGAL_ACCEPTANCE_KEY } from "./skip-legal-acceptance.decorator";

const user = { id: "00000000-0000-4000-8000-000000000001" };

function contextFor(path: string, metadata: Record<string, boolean> = {}, withUser = true) {
  const handler = () => undefined;
  const reflector = new Reflector();
  jest.spyOn(reflector, "getAllAndOverride").mockImplementation((key: unknown) => metadata[key as string]);
  const context = {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ path, user: withUser ? user : undefined }) }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

function guardWith(reflector: Reflector, pending: boolean) {
  const hasPending = jest.fn().mockResolvedValue(pending);
  return { guard: new LegalAcceptanceGuard(reflector, { hasPending } as unknown as LegalService), hasPending };
}

describe("LegalAcceptanceGuard", () => {
  it("blocks an account with pending documents with 428 LEGAL_ACCEPTANCE_REQUIRED", async () => {
    const { context, reflector } = contextFor("/api/v1/workouts");
    const { guard, hasPending } = guardWith(reflector, true);
    const outcome = guard.canActivate(context);
    await expect(outcome).rejects.toBeInstanceOf(DomainException);
    await expect(outcome).rejects.toMatchObject({ code: "LEGAL_ACCEPTANCE_REQUIRED" });
    await guard.canActivate(context).catch((error: DomainException) =>
      expect(error.getStatus()).toBe(HttpStatus.PRECONDITION_REQUIRED),
    );
    expect(hasPending).toHaveBeenCalledWith(user.id);
  });

  it("lets an account that accepted everything through with a single check", async () => {
    const { context, reflector } = contextFor("/api/v1/workouts");
    const { guard, hasPending } = guardWith(reflector, false);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(hasPending).toHaveBeenCalledTimes(1);
  });

  it.each(["/api/v1/auth/me", "/api/v1/legal/current", "/api/v1/me/legal/accept", "/api/v1/health/ready"])(
    "never queries for the exempt route %s",
    async (path) => {
      const { context, reflector } = contextFor(path);
      const { guard, hasPending } = guardWith(reflector, true);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(hasPending).not.toHaveBeenCalled();
    },
  );

  it.each([IS_PUBLIC_ROUTE_KEY, SKIP_LEGAL_ACCEPTANCE_KEY])("honours the %s metadata", async (key) => {
    const { context, reflector } = contextFor("/api/v1/workouts", { [key]: true });
    const { guard, hasPending } = guardWith(reflector, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(hasPending).not.toHaveBeenCalled();
  });

  it("leaves unauthenticated requests to the authentication guard", async () => {
    const { context, reflector } = contextFor("/api/v1/workouts", {}, false);
    const { guard, hasPending } = guardWith(reflector, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(hasPending).not.toHaveBeenCalled();
  });
});

describe("isExemptPath", () => {
  it("matches whole path segments only", () => {
    expect(isExemptPath("/api/v1/me/legal/pending", "api/v1")).toBe(true);
    expect(isExemptPath("/api/v1/health", "api/v1")).toBe(true);
    expect(isExemptPath("/api/v1/me/legalese", "api/v1")).toBe(false);
    expect(isExemptPath("/api/v1/authors", "api/v1")).toBe(false);
    expect(isExemptPath("/api/v1/me/profile", "api/v1")).toBe(false);
  });
});
