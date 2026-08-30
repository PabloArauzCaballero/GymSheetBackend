import { BranchModel } from './branch.model';
import { publicRoomTypes } from './public-facilities.schemas';

/**
 * Proyección pública de una sede: solo lo que alguien eligiendo gimnasio
 * necesita ver, nunca `metadata`, `code` ni nada del lado operativo
 * (accesos, mantenimiento, quién asignó qué equipo).
 */
export type PublicBranchSummary = {
  id: string;
  nombre: string;
  descripcion: string | null;
  latitud: number | null;
  longitud: number | null;
  servicios: string[];
  imagenUrl: string | null;
  amenidades: string[];
  marca: string | null;
};

export function mapPublicBranchSummary(branch: BranchModel): PublicBranchSummary {
  const servicios = [
    ...new Set(
      (branch.rooms ?? [])
        .map((room) => room.roomType)
        .filter((roomType) => (publicRoomTypes as readonly string[]).includes(roomType)),
    ),
  ];
  return {
    id: branch.id,
    nombre: branch.name,
    descripcion: branch.description,
    latitud: branch.latitude === null ? null : Number(branch.latitude),
    longitud: branch.longitude === null ? null : Number(branch.longitude),
    servicios,
    imagenUrl: branch.coverImageUrl,
    amenidades: branch.amenities,
    marca: branch.brandName,
  };
}

export type PublicBranchDetail = PublicBranchSummary & {
  zonaHoraria: string;
  salas: Array<{ id: string; nombre: string; tipo: string }>;
  equipamiento: Array<{ nombre: string; tipo: string }>;
  galeria: string[];
  /** Todas las sedes de la misma cadena (incluida esta) — vacío si no hay marca. */
  sucursales: PublicBranchSummary[];
};

export function mapPublicBranchDetail(
  branch: BranchModel,
  siblings: BranchModel[],
): PublicBranchDetail {
  const rooms = (branch.rooms ?? []).filter((room) =>
    (publicRoomTypes as readonly string[]).includes(room.roomType),
  );
  const equipmentById = new Map<string, { nombre: string; tipo: string }>();
  for (const room of rooms) {
    for (const assignment of room.equipmentAssignments ?? []) {
      const equipment = assignment.equipment;
      if (equipment) equipmentById.set(equipment.id, { nombre: equipment.name, tipo: equipment.type });
    }
  }
  return {
    ...mapPublicBranchSummary(branch),
    zonaHoraria: branch.timeZone,
    salas: rooms.map((room) => ({ id: room.id, nombre: room.name, tipo: room.roomType })),
    equipamiento: [...equipmentById.values()],
    galeria: branch.galleryImageUrls,
    sucursales: siblings.map(mapPublicBranchSummary),
  };
}
