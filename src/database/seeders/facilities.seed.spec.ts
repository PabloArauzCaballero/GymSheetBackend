import type { Transaction } from "sequelize";

// `env` se sustituye para que la prueba no dependa del `.env` de quien la corra:
// el gimnasio de la casa se resuelve por `DEFAULT_TENANT_ID`, y eso es
// exactamente lo que hay que fijar aquí.
jest.mock("../../config/env", () => ({
  env: { DEFAULT_TENANT_ID: "topfitness" },
}));

/** Forma de la llamada a `findOrCreate` que hace el seed, lo único que se inspecciona. */
interface SeedUpsert {
  where: Record<string, unknown>;
  defaults: Record<string, unknown>;
}

const branchUpdate = jest.fn(async (values: Record<string, unknown>) => values);
const branchFindOrCreate = jest.fn(async (options: SeedUpsert) => [
  { id: "branch-id", ...options.defaults, update: branchUpdate },
  true,
]);
const tenantFindOrCreate = jest.fn(async (options: SeedUpsert) => [
  { ...options.defaults },
  true,
]);

jest.mock("../../modules/facilities/branch.model", () => ({
  BranchModel: { findOrCreate: branchFindOrCreate },
}));
jest.mock("../../modules/facilities/room.model", () => ({
  RoomModel: { findOrCreate: jest.fn(async () => [{ id: "room-id" }, true]) },
}));
jest.mock("../../modules/tenants/tenant.model", () => ({
  TenantModel: { findOrCreate: tenantFindOrCreate },
}));

import {
  brandTenantId,
  resolveBrandTenants,
  seedFacilities,
  slugifyBrandName,
} from "./facilities.seed";

const transaction = {} as Transaction;

/** Sedes sembradas, indexadas por código, tal y como las pidió el seed. */
function createdBranches(): Map<string, Record<string, unknown>> {
  const rows = new Map<string, Record<string, unknown>>();
  for (const [options] of branchFindOrCreate.mock.calls) {
    rows.set(options.defaults.code as string, options.defaults);
  }
  return rows;
}

describe("brandTenantId", () => {
  it("deriva un identificador estable del nombre de la marca", () => {
    expect(brandTenantId("Aesgym", "topfitness")).toBe("aesgym");
    expect(brandTenantId("UFC Gym Bolivia", "topfitness")).toBe(
      "ufc-gym-bolivia",
    );
    expect(brandTenantId("Body Masters Fitness Center", "topfitness")).toBe(
      "body-masters-fitness-center",
    );
  });

  it("adscribe la marca propia del producto al gimnasio por defecto", () => {
    expect(brandTenantId("Top Fitness Center", "topfitness")).toBe(
      "topfitness",
    );
    expect(brandTenantId("Top Fitness Center", "default")).toBe("default");
  });

  it("produce identificadores que satisfacen ck_tenants_id", () => {
    for (const { tenantId } of resolveBrandTenants("topfitness")) {
      expect(tenantId).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(tenantId.length).toBeLessThanOrEqual(60);
    }
  });

  it("normaliza acentos y signos en lugar de dejarlos pasar al identificador", () => {
    expect(slugifyBrandName("Gimnasio Piraí — Ñuflo")).toBe(
      "gimnasio-pirai-nuflo",
    );
  });

  it("rechaza una marca que no deja ningún carácter utilizable", () => {
    expect(() => slugifyBrandName("—")).toThrow("empty tenant identifier");
  });
});

describe("resolveBrandTenants", () => {
  it("declara un gimnasio por marca, sin repetir la marca con varias sedes", () => {
    const tenants = resolveBrandTenants("topfitness");
    const brands = tenants.map((tenant) => tenant.brandName);

    expect(new Set(brands).size).toBe(brands.length);
    expect(tenants).toEqual(
      expect.arrayContaining([
        { brandName: "Megatlon", tenantId: "megatlon" },
        { brandName: "Aesgym", tenantId: "aesgym" },
        { brandName: "Top Fitness Center", tenantId: "topfitness" },
        { brandName: "Ultrafit", tenantId: "ultrafit" },
        { brandName: "UFC Gym Bolivia", tenantId: "ufc-gym-bolivia" },
      ]),
    );
  });
});

describe("seedFacilities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("no toca sedes ni catálogo de gimnasios en el modo base", async () => {
    const result = await seedFacilities("base", transaction);

    expect(result).toEqual({
      tenantsCreated: 0,
      branchesCreated: 0,
      branchesUpdated: 0,
    });
    expect(tenantFindOrCreate).not.toHaveBeenCalled();
    expect(branchFindOrCreate).not.toHaveBeenCalled();
  });

  it("asegura el gimnasio de cada marca antes de crear ninguna sede", async () => {
    await seedFacilities("mock", transaction);

    const tenantIds = tenantFindOrCreate.mock.calls.map(
      ([options]) => options.where.id,
    );
    expect(tenantIds).toEqual([
      "megatlon",
      "aesgym",
      "topfitness",
      "ultrafit",
      "body-masters-fitness-center",
      "ufc-gym-bolivia",
    ]);
    // La foránea `fk_branches_tenant` exige que el catálogo esté escrito antes
    // que la primera sede; invertir el orden reventaría contra la base real.
    expect(tenantFindOrCreate.mock.invocationCallOrder.at(-1)).toBeLessThan(
      branchFindOrCreate.mock.invocationCallOrder[0],
    );
  });

  it("crea cada sede bajo el gimnasio de su propia marca, no bajo el de la casa", async () => {
    await seedFacilities("all", transaction);
    const branches = createdBranches();

    // Contra el código original TODAS caían en el DEFAULT de columna
    // (`topfitness`), y un socio de Top Fitness veía en su directorio a un socio
    // con sucursal "Aesgym — Utepsa".
    expect(branches.get("aesgym-utepsa")?.tenantId).toBe("aesgym");
    expect(branches.get("megatlon-24-septiembre")?.tenantId).toBe("megatlon");
    expect(branches.get("ufc-gym-ventura")?.tenantId).toBe("ufc-gym-bolivia");
    expect(branches.get("top-fitness-zona-norte")?.tenantId).toBe("topfitness");

    for (const branch of branches.values()) {
      expect(branch.tenantId).toBe(brandTenantId(branch.brandName as string));
    }
  });

  it("corrige el gimnasio de una sede ya existente, sin duplicarla", async () => {
    branchFindOrCreate.mockImplementation(async (options: SeedUpsert) => [
      { id: "branch-id", ...options.defaults, update: branchUpdate },
      false,
    ]);

    const result = await seedFacilities("all", transaction);

    // Buscar por `code` a secas es lo que permite alcanzar la fila mal
    // adscrita; buscarla ya con su tenant correcto no la encontraría y crearía
    // una segunda sede, dejando la equivocada en el directorio ajeno.
    for (const [options] of branchFindOrCreate.mock.calls) {
      expect(Object.keys(options.where)).toEqual(["code"]);
    }
    const updatedTenants = branchUpdate.mock.calls.map(
      ([values]) => values.tenantId,
    );
    expect(updatedTenants).toContain("aesgym");
    expect(updatedTenants).not.toContain(undefined);
    expect(result.branchesCreated).toBe(0);
    expect(result.branchesUpdated).toBe(updatedTenants.length);
  });
});
