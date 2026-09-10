import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { UserRole } from "../enums/domain.enums";
import { AuthenticatedUser } from "../types/auth-context.types";
import { resolveCatalogTenant } from "./catalog-scope";

function actor(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email: "actor@example.test",
    role: UserRole.ADMIN,
    tenantId: "topfitness",
    tenantScope: "topfitness",
    impersonating: false,
    ...overrides,
  };
}

describe("resolveCatalogTenant", () => {
  it("escribe en su propio gimnasio cuando un ADMIN no declara alcance", () => {
    expect(resolveCatalogTenant(actor({}), undefined)).toBe("topfitness");
  });

  /**
   * El gimnasio sale del token, no del cuerpo: un ADMIN no puede nombrar otro
   * gimnasio ni por error ni a propósito, así que el único intento posible es
   * subir de nivel, y eso se le niega.
   */
  it("niega a un ADMIN de gimnasio tocar el catálogo global", () => {
    expect(() => resolveCatalogTenant(actor({}), "GLOBAL")).toThrow(ForbiddenException);
  });

  it("escribe en el gimnasio suplantado cuando no se declara alcance", () => {
    const suplantador = actor({
      role: UserRole.SYSTEM_ADMIN,
      tenantId: "gimnasio-vecino",
      tenantScope: "gimnasio-vecino",
      impersonating: true,
    });

    expect(resolveCatalogTenant(suplantador, undefined)).toBe("gimnasio-vecino");
  });

  /**
   * 400 y no 403: el permiso lo tiene: lo que no encaja es la petición, porque
   * el token está acotado al gimnasio suplantado. Distinguirlos le dice al
   * cliente que la salida es soltar la suplantación, no pedir permisos.
   */
  it("rechaza el catalogo global mientras se suplanta", () => {
    const suplantador = actor({
      role: UserRole.SYSTEM_ADMIN,
      tenantScope: "gimnasio-vecino",
      impersonating: true,
    });

    expect(() => resolveCatalogTenant(suplantador, "GLOBAL")).toThrow(BadRequestException);
  });

  it("escribe en el catalogo global para un SYSTEM_ADMIN que no suplanta", () => {
    const plataforma = actor({ role: UserRole.SYSTEM_ADMIN, tenantScope: null });

    expect(resolveCatalogTenant(plataforma, "GLOBAL")).toBeNull();
  });

  /**
   * El caso que justifica que `alcance` no tenga valor por defecto. Un supra
   * inquilino no tiene «su» gimnasio, así que cualquier defecto sería una
   * suposición: caer a global publica la fila en todos los gimnasios de golpe.
   */
  it("exige declarar el nivel a un SYSTEM_ADMIN que no suplanta", () => {
    const plataforma = actor({ role: UserRole.SYSTEM_ADMIN, tenantScope: null });

    expect(() => resolveCatalogTenant(plataforma, undefined)).toThrow(BadRequestException);
  });
});
