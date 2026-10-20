import { ARENAS, buildArenas, earnedPoints } from "./progression-arenas";
import { levelSeeds } from "./progression-catalog";

describe("camino de arenas", () => {
  it("sube sin escalones repetidos y empieza en cero", () => {
    expect(ARENAS).toHaveLength(16);
    expect(ARENAS[0].minPoints).toBe(0);
    ARENAS.slice(1).forEach((arena, index) => {
      expect(arena.minPoints).toBeGreaterThan(ARENAS[index].minPoints);
    });
    expect(new Set(ARENAS.map((arena) => arena.code)).size).toBe(ARENAS.length);
  });

  /**
   * Subir de rango tiene que ser entrar en una arena: si un umbral de rango
   * cayera a mitad de un tramo, el ascenso se celebraría sin cambiar de lugar.
   */
  it("hace coincidir cada rango sembrado con una arena impar", () => {
    const rankThresholds = levelSeeds
      .filter((level) => level.audience === "ANY")
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((level) => level.minPoints);
    const oddArenas = ARENAS.filter((_, index) => index % 2 === 0).map((arena) => arena.minPoints);
    expect(oddArenas).toEqual(rankThresholds);
  });

  it("da a cada arena al menos tres hitos en todas las ramas", () => {
    for (const audience of ["ANY", "MALE", "FEMALE"] as const) {
      buildArenas(audience, 0).forEach((arena) => {
        expect(arena.milestones.length).toBeGreaterThanOrEqual(3);
      });
    }
    const coliseo = (audience: "MALE" | "FEMALE") =>
      buildArenas(audience, 0).find((arena) => arena.code === "COLISEO")?.milestones;
    expect(coliseo("MALE")).not.toEqual(coliseo("FEMALE"));
  });

  it("marca como actual la última arena alcanzada", () => {
    const arenas = buildArenas("ANY", 4691);
    expect(arenas.filter((arena) => arena.current).map((arena) => arena.code)).toEqual(["JAULA"]);
    expect(arenas.filter((arena) => arena.unlocked)).toHaveLength(7);
    expect(buildArenas("ANY", 100000).at(-1)?.current).toBe(true);
  });

  it("no baja de arena al canjear ni al penalizar: cuenta solo lo ganado", () => {
    const breakdown = { session: 3000, sets: 1200, badges: 500, penalties: 300, strikePurchases: 150 };
    expect(earnedPoints(breakdown)).toBe(4700);
  });
});
