import { Transaction } from "sequelize";
import { FacilityStatus, RoomType } from "../../common/enums/domain.enums";
import { BranchModel } from "../../modules/facilities/branch.model";
import { RoomModel } from "../../modules/facilities/room.model";

function unsplash(id: string) {
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;
}

/**
 * Directorio público de sedes para desarrollo: gimnasios reales de Santa Cruz
 * de la Sierra, para que el directorio público no arranque vacío en local/demo.
 * Direcciones tomadas de directorios públicos (redes sociales y guías de la
 * ciudad); los servicios listados son una estimación razonable por tipo de
 * gimnasio, no un inventario verificado. Las coordenadas son una ubicación
 * aproximada por zona/anillo (no un GPS verificado por sede) — suficientes
 * para el mapa del directorio, pero deliberadamente sin `geofenceRadiusM`:
 * eso es lo que activa la verificación de racha por geolocalización
 * (`resolveGeoVerification`), y no vamos a activar esa mecánica de juego
 * real para negocios con los que no tenemos relación. Las comodidades y la
 * galería son igual de ilustrativas que los servicios: fotos de stock de
 * gimnasios genéricos, no fotos reales de cada sede.
 */
const branchSeeds: Array<{
  code: string;
  name: string;
  brandName: string;
  description: string;
  services: RoomType[];
  latitude: number;
  longitude: number;
  coverImageUrl: string;
  amenities: string[];
  galleryImageIds: string[];
}> = [
  {
    code: "megatlon-24-septiembre",
    name: "Megatlon Fitness Club — Centro",
    brandName: "Megatlon",
    description: "C. 24 de Septiembre #646, entre Rafael Peña y Celso Castedo.",
    services: [RoomType.TRAINING, RoomType.CARDIO, RoomType.FUNCTIONAL, RoomType.CLASSROOM],
    latitude: -17.7838,
    longitude: -63.1815,
    coverImageUrl: unsplash("1550345332-09e3ac987658"),
    amenities: ["Estacionamiento", "Vestidores y duchas", "Aire acondicionado", "Clases grupales"],
    galleryImageIds: ["1517130038641-a774d04afb3c", "1571008887538-b36bb32f4571", "1518611012118-696072aa579a"],
  },
  {
    code: "megatlon-express-21-mayo",
    name: "Megatlon Express — 21 de Mayo",
    brandName: "Megatlon",
    description: "Av. 21 de Mayo #50, entre Ayacucho y Junín, 1er piso.",
    services: [RoomType.TRAINING, RoomType.CARDIO],
    latitude: -17.7828,
    longitude: -63.1795,
    coverImageUrl: unsplash("1584735175315-9d5df23860e6"),
    amenities: ["Aire acondicionado", "Wifi gratis"],
    galleryImageIds: ["1576678927484-cc907957088c", "1554284126-aa88f22d8b74", "1600880292203-757bb62b4baf"],
  },
  {
    code: "aesgym-centro-bolivar",
    name: "Aesgym — Centro",
    brandName: "Aesgym",
    description: "C. Bolívar #588. Dos plantas de sala de pesas y cardio.",
    services: [RoomType.TRAINING, RoomType.CARDIO, RoomType.FUNCTIONAL],
    latitude: -17.7815,
    longitude: -63.184,
    coverImageUrl: unsplash("1571019613454-1cb2f99b2d8b"),
    amenities: ["Vestidores y duchas", "Tienda de suplementos", "Entrenador personal"],
    galleryImageIds: ["1548690312-e3b507d8c110", "1434682772747-f16d3ea162c3", "1541534741688-6078c6bfb5c5"],
  },
  {
    code: "aesgym-utepsa",
    name: "Aesgym — Utepsa",
    brandName: "Aesgym",
    description: "Av. Noel Kempff Mercado, cerca de la Utepsa.",
    services: [RoomType.TRAINING, RoomType.CARDIO],
    latitude: -17.759,
    longitude: -63.1751,
    coverImageUrl: unsplash("1540497077202-7c8a3999166f"),
    amenities: ["Wifi gratis", "Estacionamiento"],
    galleryImageIds: ["1584464491033-06628f3a6b7b", "1554068865-24cecd4e34b8", "1470468969717-61d5d54fd036"],
  },
  {
    code: "aesgym-pirai",
    name: "Aesgym — Piraí",
    brandName: "Aesgym",
    description: "Av. Piraí, entre 2do y 3er anillo.",
    services: [RoomType.TRAINING, RoomType.CARDIO, RoomType.FUNCTIONAL],
    latitude: -17.781,
    longitude: -63.2015,
    coverImageUrl: unsplash("1583454110551-21f2fa2afe61"),
    amenities: ["Estacionamiento", "Vestidores y duchas", "Aire acondicionado"],
    galleryImageIds: ["1596357395217-80de13130e92", "1601422407692-ec4eeec1d9b3", "1522898467493-49726bf28798"],
  },
  {
    code: "top-fitness-zona-norte",
    name: "Top Fitness Center — Zona Norte",
    brandName: "Top Fitness Center",
    description: "Av. Los Cusis #2010.",
    services: [RoomType.TRAINING, RoomType.CARDIO, RoomType.CLASSROOM],
    latitude: -17.762,
    longitude: -63.185,
    coverImageUrl: unsplash("1517963879433-6ad2b056d712"),
    amenities: ["Clases grupales", "Casilleros", "Wifi gratis"],
    galleryImageIds: ["1517344368193-41552b6ad3f5", "1558611848-73f7eb4001a1", "1581009137042-c552e485697a"],
  },
  {
    code: "ultrafit-los-cusis",
    name: "Ultrafit",
    brandName: "Ultrafit",
    description: "Av. Los Cusis, 3er anillo.",
    services: [RoomType.TRAINING, RoomType.CARDIO, RoomType.FUNCTIONAL],
    latitude: -17.76,
    longitude: -63.187,
    coverImageUrl: unsplash("1546483875-ad9014c88eba"),
    amenities: ["Aire acondicionado", "Tienda de suplementos", "Casilleros"],
    galleryImageIds: ["1571008887538-b36bb32f4571", "1554284126-aa88f22d8b74", "1434682772747-f16d3ea162c3"],
  },
  {
    code: "body-masters-trompillo",
    name: "Body Masters Fitness Center",
    brandName: "Body Masters Fitness Center",
    description: "C. René Moreno esq. Av. El Trompillo, Cine Center, 2do piso.",
    services: [RoomType.TRAINING, RoomType.CARDIO],
    latitude: -17.7975,
    longitude: -63.1825,
    coverImageUrl: unsplash("1571731956672-f2b94d7dd0cb"),
    amenities: ["Vestidores y duchas", "Entrenador personal"],
    galleryImageIds: ["1554068865-24cecd4e34b8", "1601422407692-ec4eeec1d9b3", "1558611848-73f7eb4001a1"],
  },
  {
    code: "ufc-gym-ventura",
    name: "UFC Gym Bolivia — Ventura",
    brandName: "UFC Gym Bolivia",
    description: "Av. Cuarto Anillo, Mall Ventura Boulevard, 2do nivel.",
    services: [RoomType.TRAINING, RoomType.CARDIO, RoomType.FUNCTIONAL, RoomType.CLASSROOM],
    latitude: -17.7565,
    longitude: -63.1965,
    coverImageUrl: unsplash("1526506118085-60ce8714f8c5"),
    amenities: [
      "Estacionamiento",
      "Vestidores y duchas",
      "Tienda de suplementos",
      "Entrenador personal",
      "Clases grupales",
    ],
    galleryImageIds: [
      "1518611012118-696072aa579a",
      "1600880292203-757bb62b4baf",
      "1541534741688-6078c6bfb5c5",
      "1470468969717-61d5d54fd036",
    ],
  },
];

const roomLabel: Record<RoomType, string> = {
  [RoomType.TRAINING]: "Sala de pesas",
  [RoomType.CARDIO]: "Cardio",
  [RoomType.FUNCTIONAL]: "Funcional",
  [RoomType.CLASSROOM]: "Clases",
  [RoomType.LOCKER]: "Vestidores",
  [RoomType.RECEPTION]: "Recepción",
  [RoomType.STAFF]: "Personal",
  [RoomType.OTHER]: "Otro",
};

export async function seedFacilities(
  mode: "base" | "mock" | "all",
  transaction: Transaction,
): Promise<{ branchesCreated: number; branchesUpdated: number }> {
  if (mode === "base") return { branchesCreated: 0, branchesUpdated: 0 };

  let branchesCreated = 0;
  let branchesUpdated = 0;
  for (const seed of branchSeeds) {
    const galleryImageUrls = seed.galleryImageIds.map(unsplash);
    const [branch, created] = await BranchModel.findOrCreate({
      where: { code: seed.code },
      defaults: {
        code: seed.code,
        name: seed.name,
        brandName: seed.brandName,
        description: seed.description,
        timeZone: "America/La_Paz",
        status: FacilityStatus.ACTIVE,
        latitude: seed.latitude,
        longitude: seed.longitude,
        coverImageUrl: seed.coverImageUrl,
        amenities: seed.amenities,
        galleryImageUrls,
        metadata: { developmentOnly: true },
      },
      transaction,
    });
    if (created) branchesCreated += 1;
    else {
      await branch.update(
        {
          name: seed.name,
          brandName: seed.brandName,
          description: seed.description,
          status: FacilityStatus.ACTIVE,
          latitude: seed.latitude,
          longitude: seed.longitude,
          coverImageUrl: seed.coverImageUrl,
          amenities: seed.amenities,
          galleryImageUrls,
        },
        { transaction },
      );
      branchesUpdated += 1;
    }
    for (const roomType of seed.services) {
      const code = roomType.toLowerCase();
      await RoomModel.findOrCreate({
        where: { branchId: branch.id, code },
        defaults: {
          branchId: branch.id,
          code,
          name: roomLabel[roomType],
          roomType,
        },
        transaction,
      });
    }
  }
  return { branchesCreated, branchesUpdated };
}
