import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EquipmentResponse, mapEquipmentToResponse } from './equipment.mapper';
import { equipmentCatalog, equipmentCatalogZones } from './equipment-catalog';
import { EquipmentRepository } from './equipment.repository';
import {
  CreateEquipmentInput,
  UpdateEquipmentInput,
  createEquipmentSchema,
} from './equipment.schemas';

@Injectable()
export class EquipmentService {
  constructor(private readonly equipmentRepository: EquipmentRepository) {}

  async listAvailableEquipment(): Promise<EquipmentResponse[]> {
    const equipmentItems = await this.equipmentRepository.findAvailable();
    return equipmentItems.map(mapEquipmentToResponse);
  }

  /** El catálogo sugerido, agrupado por zona y en el orden de presentación. */
  listCatalog() {
    return equipmentCatalogZones.map((zona) => ({
      zona,
      equipos: equipmentCatalog
        .filter((item) => item.zona === zona)
        .map(({ clave, nombre, tipo }) => ({ clave, nombre, tipo })),
    }));
  }

  /**
   * Copia al gimnasio el equipamiento que eligió del catálogo sugerido.
   *
   * Se salta lo que ya tenga con ese nombre en vez de fallar: quien vuelve a
   * esta pantalla suele hacerlo para añadir lo que le faltó, y castigarle con
   * un error por marcar de nuevo lo que ya marcó convierte una corrección en un
   * problema. Devuelve qué se creó y qué se omitió, que es lo que la pantalla
   * necesita para decir la verdad.
   */
  async seedFromCatalog(claves: readonly string[]) {
    const seleccion = equipmentCatalog.filter((item) => claves.includes(item.clave));
    const desconocidas = claves.filter(
      (clave) => !equipmentCatalog.some((item) => item.clave === clave),
    );
    if (desconocidas.length > 0) {
      throw new UnprocessableEntityException(
        `El catálogo no reconoce: ${desconocidas.join(', ')}.`,
      );
    }

    const existentes = new Set(
      (await this.equipmentRepository.findAll()).map((item) => item.name.toLowerCase()),
    );

    const creados: EquipmentResponse[] = [];
    const omitidos: string[] = [];
    for (const item of seleccion) {
      if (existentes.has(item.nombre.toLowerCase())) {
        omitidos.push(item.nombre);
        continue;
      }
      // Se compone pasando por el mismo esquema que valida un alta manual, en
      // vez de armar el objeto a mano: así el catálogo no puede introducir una
      // ficha que el endpoint público habría rechazado.
      const equipment = await this.equipmentRepository.create(
        createEquipmentSchema.parse({
          nombre: item.nombre,
          tipo: item.tipo,
          metadata: { catalogo: item.clave, zona: item.zona },
        }),
      );
      creados.push(mapEquipmentToResponse(equipment));
      existentes.add(item.nombre.toLowerCase());
    }
    return { creados, omitidos };
  }

  async createEquipment(input: CreateEquipmentInput): Promise<EquipmentResponse> {
    const equipment = await this.equipmentRepository.create(input);
    return mapEquipmentToResponse(equipment);
  }

  async updateEquipment(
    equipmentId: string,
    input: UpdateEquipmentInput,
  ): Promise<EquipmentResponse> {
    const equipment = await this.equipmentRepository.update(equipmentId, input);

    if (!equipment) {
      throw new NotFoundException('Equipo no encontrado.');
    }

    return mapEquipmentToResponse(equipment);
  }

  async inactivateEquipment(equipmentId: string): Promise<EquipmentResponse> {
    const equipment = await this.equipmentRepository.markInactive(equipmentId);

    if (!equipment) {
      throw new NotFoundException('Equipo no encontrado.');
    }

    return mapEquipmentToResponse(equipment);
  }
}
