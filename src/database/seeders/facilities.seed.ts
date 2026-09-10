import { Transaction } from "sequelize";
import { FacilityStatus, RoomType } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { BranchModel } from "../../modules/facilities/branch.model";
import { RoomModel } from "../../modules/facilities/room.model";
import { TenantModel } from "../../modules/tenants/tenant.model";

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
 *
 * Son cadenas RIVALES entre sí, así que cada marca es un gimnasio distinto del
 * catálogo (`public.tenants`) y no comparten perímetro: ver `brandTenantId`.
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

/**
 * Marca propia del producto. Sus sedes NO son de una cadena ajena: son las del
 * gimnasio de referencia de la instalación, el mismo al que se adscriben las
 * cuentas sin `tenant_id` propio (`DEFAULT_TENANT_ID`, `topfitness` en
 * desarrollo). Darle un identificador nuevo derivado del nombre la sacaría del
 * perímetro de sus propios socios, que es justo lo contrario de lo que hace
 * falta.
 */
const HOUSE_BRAND_NAME = "Top Fitness Center";

/**
 * Identificador de gimnasio a partir del nombre de la marca. Debe satisfacer
 * `ck_tenants_id` (`^[a-z0-9][a-z0-9-]*$`, `varchar(60)`), y ser estable entre
 * ejecuciones: es la clave primaria del catálogo y viaja en `usuarios.tenant_id`
 * y en la URL de acceso, así que no puede depender de un contador ni del orden.
 */
export function slugifyBrandName(brandName: string): string {
  const slug = brandName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  if (!slug) {
    throw new Error(`Brand "${brandName}" produces an empty tenant identifier.`);
  }
  return slug;
}

/** Gimnasio dueño de una marca: la casa va al tenant por defecto, el resto a su slug. */
export function brandTenantId(
  brandName: string,
  defaultTenantId: string = env.DEFAULT_TENANT_ID,
): string {
  return brandName === HOUSE_BRAND_NAME
    ? defaultTenantId
    : slugifyBrandName(brandName);
}

/**
 * Catálogo de gimnasios que exige este seed, uno por marca sembrada.
 *
 * Cada sede pertenece a la cadena que la explota, no a quien corrió el seed: sin
 * esto las nueve sedes caían en el DEFAULT de columna (`topfitness`) y un socio
 * veía en su directorio sucursales de gimnasios rivales.
 *
 * Dos marcas distintas que colapsaran en el mismo identificador se fundirían en
 * silencio en un solo gimnasio, así que se detecta y se falla antes de escribir.
 */
export function resolveBrandTenants(
  defaultTenantId: string = env.DEFAULT_TENANT_ID,
): Array<{ brandName: string; tenantId: string }> {
  const tenants: Array<{ brandName: string; tenantId: string }> = [];
  const owners = new Map<string, string>();
  for (const seed of branchSeeds) {
    const tenantId = brandTenantId(seed.brandName, defaultTenantId);
    const owner = owners.get(tenantId);
    if (owner === seed.brandName) continue;
    if (owner) {
      throw new Error(
        `Brands "${owner}" and "${seed.brandName}" both resolve to tenant "${tenantId}".`,
      );
    }
    owners.set(tenantId, seed.brandName);
    tenants.push({ brandName: seed.brandName, tenantId });
  }
  return tenants;
}

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
): Promise<{
  tenantsCreated: number;
  branchesCreated: number;
  branchesUpdated: number;
}> {
  // El modo `base` es el que corre en producción: ni una sede de demostración,
  // ni por tanto un gimnasio de demostración en el catálogo.
  if (mode === "base")
    return { tenantsCreated: 0, branchesCreated: 0, branchesUpdated: 0 };

  // Primero el catálogo de gimnasios: `fk_branches_tenant` exige que la fila de
  // `public.tenants` exista antes de que ninguna sede la referencie.
  let tenantsCreated = 0;
  for (const tenant of resolveBrandTenants()) {
    // `findOrCreate` y no `upsert`: el nombre de un gimnasio ya existente es
    // dato de administración (el Admin Portal lo edita), no del seed. Sólo se
    // aporta como valor inicial cuando la fila aún no está.
    const [, created] = await TenantModel.findOrCreate({
      where: { id: tenant.tenantId },
      defaults: {
        id: tenant.tenantId,
        nombre: tenant.brandName,
        estado: "ACTIVO",
      },
      transaction,
    });
    if (created) tenantsCreated += 1;
  }

  let branchesCreated = 0;
  let branchesUpdated = 0;
  for (const seed of branchSeeds) {
    const tenantId = brandTenantId(seed.brandName);
    const galleryImageUrls = seed.galleryImageIds.map(unsplash);
    // La búsqueda va por `code` a secas, sin el gimnasio: las filas sembradas
    // antes de este arreglo quedaron todas en el tenant por defecto, y buscarlas
    // ya con su gimnasio correcto no las encontraría — crearía un duplicado y
    // dejaría la fila equivocada visible en el directorio ajeno.
    const [branch, created] = await BranchModel.findOrCreate({
      where: { code: seed.code },
      defaults: {
        tenantId,
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
          // El gimnasio dueño se reescribe en cada pasada, no sólo al crear: es
          // lo único que corrige las sedes ya sembradas bajo el tenant por
          // defecto sin tener que tocar la base a mano.
          tenantId,
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
  return { tenantsCreated, branchesCreated, branchesUpdated };
}
