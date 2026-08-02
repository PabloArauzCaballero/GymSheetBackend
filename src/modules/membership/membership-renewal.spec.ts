import {
  buildMembershipWhatsAppUrl,
  MEMBERSHIP_RENEWAL_MESSAGE,
} from "./membership.service";

describe("membership WhatsApp renewal", () => {
  it("uses the configured phone and exact encoded message", () => {
    const url = buildMembershipWhatsAppUrl("59177377232");
    expect(MEMBERSHIP_RENEWAL_MESSAGE).toBe(
      "Hola, quisiera renovar mi membresía",
    );
    expect(url).toBe(
      "https://wa.me/59177377232?text=Hola%2C%20quisiera%20renovar%20mi%20membres%C3%ADa",
    );
  });
});
