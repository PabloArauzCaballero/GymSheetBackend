import { UserModel } from "../users/user.model";
import { MembershipRepository } from "./membership.repository";

/**
 * H-02: hasta este cambio ninguna ruta `admin/*` comprobaba el gimnasio, así
 * que un ADMIN leía y mutaba socios, membresías y credenciales de cualquier
 * otro. Estas pruebas fijan la parte que se olvidaba: que el filtro llegue
 * hasta la consulta, y que sea un filtro de verdad (`required: true`) y no un
 * `LEFT JOIN` que devuelve la fila igual con el usuario a null.
 */
describe("MembershipRepository — alcance por gimnasio", () => {
  function repositoryWithSpies() {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    const model = { findAndCountAll };
    // Se construye sin pasar por el constructor: sólo interesan los tres
    // modelos que consultan estos métodos, y enumerar la veintena de
    // dependencias del repositorio no haría la prueba más cierta.
    const repository = Object.create(
      MembershipRepository.prototype,
    ) as MembershipRepository;
    (repository as any).customers = model;
    (repository as any).memberships = model;
    (repository as any).staff = model;
    return { repository, findAndCountAll };
  }

  function userInclude(call: Record<string, unknown>) {
    const includes = call.include as Array<Record<string, unknown>>;
    return includes.find((entry) => entry.model === UserModel);
  }

  it("acota los socios al gimnasio del actor", async () => {
    const { repository, findAndCountAll } = repositoryWithSpies();

    await repository.listCustomers(1, 20, "topfitness");

    const include = userInclude(findAndCountAll.mock.calls[0][0]);
    expect(include).toMatchObject({
      required: true,
      where: { tenantId: "topfitness" },
    });
  });

  it("no filtra cuando el alcance es toda la plataforma", async () => {
    const { repository, findAndCountAll } = repositoryWithSpies();

    await repository.listCustomers(1, 20, null);

    const include = userInclude(findAndCountAll.mock.calls[0][0]);
    // Sigue siendo `required: true`: el include existe para filtrar, y dejarlo
    // opcional aquí haría que el mismo código se comportara distinto según el
    // rol por una razón que no es el alcance.
    expect(include).toMatchObject({ required: true, where: {} });
  });

  it("acota las membresias por el gimnasio de su titular", async () => {
    const { repository, findAndCountAll } = repositoryWithSpies();

    await repository.listMemberships(
      { page: 1, pageSize: 20 },
      "gimnasio-vecino",
    );

    const include = userInclude(findAndCountAll.mock.calls[0][0]);
    expect(include).toMatchObject({
      required: true,
      where: { tenantId: "gimnasio-vecino" },
    });
  });

  it("acota el personal al gimnasio del actor", async () => {
    const { repository, findAndCountAll } = repositoryWithSpies();

    await repository.listStaff(1, 20, "topfitness");

    const include = userInclude(findAndCountAll.mock.calls[0][0]);
    expect(include).toMatchObject({
      required: true,
      where: { tenantId: "topfitness" },
    });
  });
});
