import type { Transaction } from "sequelize";

// Los modelos Sequelize se sustituyen por dobles: la prueba verifica la clave de
// búsqueda del upsert de membresía, no el acceso real a la base de datos.
const instance = () => [{ id: "mock-id", update: jest.fn() }];

jest.mock("../../modules/membership/media-file.model", () => ({
  MediaFileModel: { findOrCreate: jest.fn(instance) },
}));
jest.mock("../../modules/membership/membership-feature.model", () => ({
  MembershipFeatureModel: {
    findOrCreate: jest.fn(instance),
    findAll: jest.fn(async () => []),
  },
}));
jest.mock("../../modules/membership/membership-intent.model", () => ({
  MembershipIntentModel: { findOrCreate: jest.fn(instance) },
}));
jest.mock("../../modules/membership/membership.model", () => ({
  MembershipModel: { findOrCreate: jest.fn(instance) },
}));
jest.mock("../../modules/membership/membership-plan.model", () => ({
  MembershipPlanModel: { findOrCreate: jest.fn(instance) },
}));
jest.mock("../../modules/membership/plan-feature.model", () => ({
  PlanFeatureModel: { findOrCreate: jest.fn(instance) },
}));
jest.mock("../../modules/profiles/anthropometric-profile.model", () => ({
  AnthropometricProfileModel: { findOrCreate: jest.fn(instance) },
}));
jest.mock("../../modules/profiles/body-measurement.model", () => ({
  BodyMeasurementModel: { findOrCreate: jest.fn(instance) },
}));
jest.mock("../../modules/profiles/onboarding.model", () => ({
  OnboardingModel: { findOrCreate: jest.fn(instance) },
}));
jest.mock("../../modules/users/user.model", () => ({
  UserModel: {
    findOne: jest.fn(async () => ({ id: "user-id", update: jest.fn() })),
  },
}));

import { MembershipModel } from "../../modules/membership/membership.model";
import { seedCustomerExperience } from "./customer-experience.seed";

describe("seedCustomerExperience — idempotencia de membresías mock", () => {
  it("localiza la membresía por su clave única estable (external_reference), no por fechas volátiles", async () => {
    await seedCustomerExperience("mock", {} as Transaction);

    const calls = (MembershipModel.findOrCreate as jest.Mock).mock.calls;
    const activeCall = calls.find(
      ([options]) =>
        options.defaults?.externalReference ===
        "mock-active.mock@gymsheet.local",
    );

    // Contra el código original el `where` incluía startsOn/endsOn recalculados
    // con `new Date()` en cada arranque, lo que provocaba un insert duplicado
    // (SequelizeUniqueConstraintError 23505) en ejecuciones posteriores.
    expect(activeCall?.[0].where).toEqual({
      externalReference: "mock-active.mock@gymsheet.local",
    });
  });
});
