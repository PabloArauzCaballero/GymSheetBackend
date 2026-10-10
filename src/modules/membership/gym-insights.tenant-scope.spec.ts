import { GymInsightsService } from "./gym-insights.service";

/**
 * El endurecimiento H-02 acotó por gimnasio `MembershipRepository` (socios,
 * membresías, personal) pero no llegó hasta `GymInsightsService`, así que sus
 * cuatro informes seguían contestando sobre la plataforma entera: un `ADMIN`
 * leía el nombre, el correo y el teléfono de las cuentas de OTROS gimnasios en
 * `/admin/membership/users`, y los paneles mezclaban su actividad.
 *
 * Estas pruebas fijan lo que se olvidaba: que el alcance llegue hasta la
 * consulta como parámetro —nunca interpolado en el SQL— y que `null` siga
 * significando «sin filtro» para el único rol que puede tenerlo.
 */
describe("GymInsightsService — alcance por gimnasio", () => {
  function serviceWithSpy(rows: unknown[] = []) {
    const query = jest.fn().mockResolvedValue(rows);
    const service = Object.create(
      GymInsightsService.prototype,
    ) as GymInsightsService;
    (service as unknown as { sequelize: { query: jest.Mock } }).sequelize = {
      query,
    };
    return { service, query };
  }

  function lastCall(query: jest.Mock) {
    const [sql, options] = query.mock.calls.at(-1) as [
      string,
      { replacements: Record<string, unknown> },
    ];
    return { sql, replacements: options.replacements };
  }

  it.each([
    ["equipmentUsage", (s: GymInsightsService) => s.equipmentUsage(30, "topfitness")],
    ["peopleFlow", (s: GymInsightsService) => s.peopleFlow(30, "topfitness")],
    ["lapsedMembers", (s: GymInsightsService) => s.lapsedMembers(50, "topfitness")],
    [
      "listUsers",
      (s: GymInsightsService) =>
        s.listUsers({ page: 1, pageSize: 50, filtro: null, roles: null }, "topfitness"),
    ],
  ])("%s acota al gimnasio del actor", async (_name, run) => {
    const { service, query } = serviceWithSpy();

    await run(service);

    const { sql, replacements } = lastCall(query);
    expect(replacements.tenantScope).toBe("topfitness");
    // El alcance viaja como parámetro; interpolarlo en el texto de la consulta
    // volvería a abrir por inyección el agujero que este filtro cierra.
    expect(sql).toContain(":tenantScope");
    expect(sql).not.toContain("topfitness");
  });

  it.each([
    ["equipmentUsage", (s: GymInsightsService) => s.equipmentUsage(30, null)],
    ["peopleFlow", (s: GymInsightsService) => s.peopleFlow(30, null)],
    ["lapsedMembers", (s: GymInsightsService) => s.lapsedMembers(50, null)],
    [
      "listUsers",
      (s: GymInsightsService) =>
        s.listUsers({ page: 1, pageSize: 50, filtro: null, roles: null }, null),
    ],
  ])("%s no filtra cuando el alcance es toda la plataforma", async (_name, run) => {
    const { service, query } = serviceWithSpy();

    await run(service);

    // `null` no es «se olvidó el filtro»: la consulta lo recibe y su propia
    // condición `:tenantScope IS NULL OR ...` lo resuelve, así que el caso sin
    // filtro recorre exactamente el mismo SQL que el caso con filtro.
    expect(lastCall(query).replacements.tenantScope).toBeNull();
  });

  describe("listUsers — paginación", () => {
    function userRow(id: string, total: string) {
      return {
        id,
        nombreCompleto: "Ana",
        email: "ana@gym.test",
        rol: "CLIENTE",
        estado: "ACTIVO",
        tenantId: "topfitness",
        telefono: null,
        plan: null,
        venceEl: null,
        vigente: false,
        ultimaSesion: null,
        total,
      };
    }

    it("traduce la página a LIMIT/OFFSET y no expone la columna del conteo", async () => {
      const { service, query } = serviceWithSpy([userRow("u-1", "41")]);

      const page = await service.listUsers(
        { page: 3, pageSize: 20, filtro: null, roles: null },
        "topfitness",
      );

      expect(lastCall(query).replacements).toMatchObject({ limit: 20, offset: 40 });
      expect(page).toMatchObject({ page: 3, pageSize: 20, total: 41, totalPages: 3 });
      expect(page.items[0]).not.toHaveProperty("total");
    });

    it("filtra por rol como parámetro y no interpolando la lista", async () => {
      const { service, query } = serviceWithSpy([]);

      await service.listUsers(
        { page: 1, pageSize: 20, filtro: null, roles: "ADMIN,COACH" },
        "topfitness",
      );

      const { sql, replacements } = lastCall(query);
      expect(replacements.roles).toBe("ADMIN,COACH");
      // La lista se parte en SQL (`string_to_array`) precisamente para que
      // viaje como un único valor acotado y nunca como texto de consulta.
      expect(sql).toContain("string_to_array(:roles");
      expect(sql).not.toContain("ADMIN");
    });

    it("devuelve total cero cuando la búsqueda no encuentra a nadie", async () => {
      const { service } = serviceWithSpy([]);

      const page = await service.listUsers(
        { page: 1, pageSize: 20, filtro: "nadie", roles: null },
        "topfitness",
      );

      expect(page).toMatchObject({ items: [], total: 0, totalPages: 0 });
    });
  });
});
