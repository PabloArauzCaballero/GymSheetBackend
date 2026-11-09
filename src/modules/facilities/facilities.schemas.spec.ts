import { FacilityStatus } from "../../common/enums/domain.enums";
import { mapBranch } from "./facilities.mapper";
import type { BranchModel } from "./branch.model";
import { createBranchSchema, updateBranchSchema } from "./facilities.schemas";

describe("facilities branch schemas", () => {
  it("accepts a branch created with its location on the map", () => {
    const result = createBranchSchema.parse({
      codigo: "scz-centro",
      nombre: "Sede Centro",
      direccion: "Av. Monseñor Rivero 123, Santa Cruz",
      latitud: -17.7833,
      longitud: -63.1821,
      radioGeocercaM: 150,
    });

    expect(result).toMatchObject({
      code: "SCZ-CENTRO",
      address: "Av. Monseñor Rivero 123, Santa Cruz",
      latitude: "-17.783300",
      longitude: "-63.182100",
      geofenceRadiusM: 150,
    });
  });

  it("keeps creating branches without location (legacy clients)", () => {
    const result = createBranchSchema.parse({ codigo: "norte", nombre: "Sede Norte" });

    expect(result).toMatchObject({
      address: null,
      latitude: null,
      longitude: null,
      geofenceRadiusM: null,
    });
  });

  it("rejects a single coordinate", () => {
    expect(
      createBranchSchema.safeParse({ codigo: "norte", nombre: "Sede Norte", latitud: -17.78 })
        .success,
    ).toBe(false);
  });

  it.each([
    { latitud: 91, longitud: 0 },
    { latitud: 0, longitud: -181 },
  ])("rejects coordinates out of range %o", (coordinates) => {
    expect(
      createBranchSchema.safeParse({ codigo: "norte", nombre: "Sede Norte", ...coordinates }).success,
    ).toBe(false);
  });

  it("rejects a geofence without a location or outside 20–5000 m", () => {
    expect(
      createBranchSchema.safeParse({ codigo: "norte", nombre: "Sede Norte", radioGeocercaM: 100 })
        .success,
    ).toBe(false);
    expect(
      createBranchSchema.safeParse({
        codigo: "norte",
        nombre: "Sede Norte",
        latitud: -17.7,
        longitud: -63.1,
        radioGeocercaM: 5,
      }).success,
    ).toBe(false);
  });

  it("updates the location of an existing branch as a pair", () => {
    expect(updateBranchSchema.parse({ latitud: -16.5, longitud: -68.15 })).toEqual({
      latitude: "-16.500000",
      longitude: "-68.150000",
    });
    expect(updateBranchSchema.parse({ latitud: null, longitud: null })).toEqual({
      latitude: null,
      longitude: null,
    });
    expect(updateBranchSchema.safeParse({ longitud: -68.15 }).success).toBe(false);
  });

  it("does not touch the location when only the status changes", () => {
    expect(updateBranchSchema.parse({ estado: FacilityStatus.INACTIVE })).toEqual({
      status: FacilityStatus.INACTIVE,
    });
  });

  it("maps numeric coordinates (strings from pg) to numbers in the contract", () => {
    const branch = {
      id: "b0a1c2d3-0000-4000-8000-000000000001",
      code: "CENTRO",
      name: "Sede Centro",
      description: null,
      timeZone: "America/La_Paz",
      address: null,
      latitude: "-17.783300",
      longitude: "-63.182100",
      geofenceRadiusM: null,
      status: FacilityStatus.ACTIVE,
      metadata: {},
    } as unknown as BranchModel;

    expect(mapBranch(branch)).toMatchObject({
      direccion: null,
      latitud: -17.7833,
      longitud: -63.1821,
      radioGeocercaM: null,
    });
  });
});
