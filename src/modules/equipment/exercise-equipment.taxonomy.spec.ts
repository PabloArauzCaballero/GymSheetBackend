import { equipmentCatalog } from "./equipment-catalog";
import { resolveEquipmentClaves } from "./exercise-equipment.taxonomy";

describe("resolveEquipmentClaves", () => {
  it("infers the bench and the bar from a bench press written in Spanish", () => {
    expect(resolveEquipmentClaves("Press de banca")).toEqual(
      expect.arrayContaining(["banco-plano", "barra-olimpica"]),
    );
  });

  it("prefers the machine when the exercise names it", () => {
    const claves = resolveEquipmentClaves("Press de banca en máquina");
    expect(claves).toContain("press-banca");
    // La regla del banco se excluye a propósito: el ejercicio en máquina no
    // ocupa el banco libre, y contar ambos inflaría el uso de los dos.
    expect(claves).not.toContain("banco-plano");
  });

  it("separates assisted pull-ups from the bar", () => {
    expect(resolveEquipmentClaves("Dominadas")).toEqual(["barra-dominadas"]);
    expect(resolveEquipmentClaves("Dominadas asistidas")).toEqual([
      "dominadas-asistidas",
    ]);
  });

  it("does not confuse a hamstring curl with a biceps curl", () => {
    expect(resolveEquipmentClaves("Curl femoral")).toEqual(["curl-femoral"]);
    expect(resolveEquipmentClaves("Curl de bíceps")).toEqual(["barra-z"]);
  });

  it("ignores accents and casing, which is how names are really typed", () => {
    expect(resolveEquipmentClaves("JALÓN AL PECHO")).toEqual([
      "jalon-polea-alta",
    ]);
    expect(resolveEquipmentClaves("jalon al pecho")).toEqual([
      "jalon-polea-alta",
    ]);
  });

  it("takes the declared equipment from the imported catalogue", () => {
    expect(resolveEquipmentClaves("Some Imported Exercise", "dumbbell")).toEqual(
      ["mancuernas"],
    );
  });

  it("stays silent rather than guessing", () => {
    // Preferir el silencio es la decisión de diseño: un informe sin dato se
    // corrige, uno que atribuye series a la máquina equivocada lleva a comprar
    // la máquina equivocada y nadie sospecha del número.
    expect(resolveEquipmentClaves("Movilidad de cadera")).toEqual([]);
    expect(resolveEquipmentClaves("Ejercicio nuevo", "body weight")).toEqual([]);
  });

  it("only ever names equipment that exists in the catalogue", () => {
    // Una clave inventada se insertaría como enlace huérfano y el informe la
    // perdería en silencio, así que la correspondencia se comprueba entera.
    const known = new Set(equipmentCatalog.map((item) => item.clave));
    const names = [
      "Press de banca",
      "Press de banca en máquina",
      "Press inclinado con mancuernas",
      "Sentadilla trasera",
      "Hack squat",
      "Prensa de piernas",
      "Peso muerto convencional",
      "Hip thrust",
      "Remo con barra",
      "Remo sentado en polea",
      "Jalón al pecho",
      "Dominadas",
      "Dominadas asistidas",
      "Fondos en paralelas",
      "Extensión de tríceps en polea",
      "Curl de bíceps con barra",
      "Curl femoral",
      "Extensión de cuádriceps",
      "Elevaciones laterales",
      "Press militar",
      "Gemelos de pie",
      "Cinta de correr",
      "Bicicleta estática",
      "Plancha abdominal",
    ];

    for (const name of names) {
      for (const clave of resolveEquipmentClaves(name)) {
        expect(known).toContain(clave);
      }
    }
  });
});
