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
const strayUpdate = jest.fn();
jest.mock("../../modules/membership/membership.model", () => ({
  MembershipModel: {
    findOrCreate: jest.fn(instance),
    // Una membresía ajena a la siembra, como la que deja cualquier prueba de
    // activación manual sobre una cuenta de escenario.
    findAll: jest.fn(async () => [{ id: "stray-id", update: strayUpdate }]),
  },
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

  it("aparta las membresías que la siembra no creó, para que la cuenta siga representando su escenario", async () => {
    strayUpdate.mockClear();
    await seedCustomerExperience("mock", {} as Transaction);

    // No se borra —el historial de estados es sólo-añadir— sino que se desplaza
    // al pasado: deja de ser la vigente y la más reciente, y la pantalla vuelve
    // a mostrar el caso que la cuenta representa.
    expect(strayUpdate).toHaveBeenCalled();
    const [values] = strayUpdate.mock.calls[0] as [
      { startsOn: string; endsOn: string },
    ];
    expect(new Date(values.endsOn).getTime()).toBeLessThan(Date.now());
    expect(new Date(values.startsOn).getTime()).toBeLessThan(
      new Date(values.endsOn).getTime(),
    );
  });
});
