import { testAntibotConfig } from "../testing/antibot-test-config";
import { AppAttestVerifier } from "./app-attest.verifier";
import type { AttestationChallengeService } from "./attestation-challenge.service";
import { AttestationGate } from "./attestation-gate";
import type { AttestationOutcome, PlayIntegrityVerifier } from "./play-integrity.verifier";

const android = { platform: "android" as const, token: "integrity", nonce: "nonce" };
const ios = { platform: "ios" as const, token: "attest", nonce: "nonce" };

function gate(options: { enabled: boolean; outcome?: AttestationOutcome; nonceValid?: boolean }) {
  const challenges = { consume: jest.fn(() => Promise.resolve(options.nonceValid ?? true)) };
  const playIntegrity = options.enabled
    ? { verify: jest.fn(() => Promise.resolve(options.outcome ?? "PASSED")) }
    : null;
  return new AttestationGate(
    testAntibotConfig({ attestationEnabled: options.enabled }),
    playIntegrity as unknown as PlayIntegrityVerifier | null,
    challenges as unknown as AttestationChallengeService,
    new AppAttestVerifier(),
  );
}

describe("AttestationGate", () => {
  it("ignores web signups", async () => {
    await expect(gate({ enabled: true }).assess("WEB", null)).resolves.toBeNull();
  });

  describe("enforced (ATTESTATION_ENABLED, Android)", () => {
    it("passes a verified device", async () => {
      await expect(gate({ enabled: true }).assess("ANDROID", android)).resolves.toBeNull();
    });

    it("rejects a missing attestation, a wrong platform, a bad nonce and a failed verdict", async () => {
      await expect(gate({ enabled: true }).assess("ANDROID", null)).resolves.toBe("REJECT");
      await expect(gate({ enabled: true }).assess("ANDROID", ios)).resolves.toBe("REJECT");
      await expect(gate({ enabled: true, nonceValid: false }).assess("ANDROID", android)).resolves.toBe("REJECT");
      await expect(gate({ enabled: true, outcome: "FAILED" }).assess("ANDROID", android)).resolves.toBe("REJECT");
    });

    it("only raises risk when Google is unavailable", async () => {
      await expect(gate({ enabled: true, outcome: "UNAVAILABLE" }).assess("ANDROID", android)).resolves.toBe(
        "ATTESTATION_UNAVAILABLE",
      );
    });
  });

  it("keeps iOS as a risk signal even when attestation is enabled (App Attest unsupported)", async () => {
    await expect(gate({ enabled: true }).assess("IOS", null)).resolves.toBe("ATTESTATION_MISSING");
    await expect(gate({ enabled: true }).assess("IOS", ios)).resolves.toBe("ATTESTATION_UNVERIFIED");
  });

  it("raises risk instead of rejecting while attestation is not enforced", async () => {
    await expect(gate({ enabled: false }).assess("ANDROID", null)).resolves.toBe("ATTESTATION_MISSING");
    await expect(gate({ enabled: false }).assess("ANDROID", android)).resolves.toBe("ATTESTATION_UNVERIFIED");
  });
});
