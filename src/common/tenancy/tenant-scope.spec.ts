import { tenantScopeWhere } from "./tenant-scope";

describe("tenantScopeWhere", () => {
  it("no filtra nada cuando el alcance es todos los gimnasios", () => {
    expect(tenantScopeWhere(null)).toEqual({});
  });

  it("acota al gimnasio indicado", () => {
    expect(tenantScopeWhere("topfitness")).toEqual({ tenantId: "topfitness" });
  });

  /**
   * Un alcance vacío no es «todos»: si alguna vez llegara una cadena vacía por
   * un dato mal migrado, debe filtrar por ella y no devolver el gimnasio
   * entero de todo el mundo. Sólo `null` abre el filtro.
   */
  it("trata la cadena vacia como un gimnasio, no como ausencia de filtro", () => {
    expect(tenantScopeWhere("")).toEqual({ tenantId: "" });
  });
});
