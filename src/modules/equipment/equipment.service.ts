import { Injectable, NotFoundException } from '@nestjs/common';
import { EquipmentResponse, mapEquipmentToResponse } from './equipment.mapper';
import { EquipmentRepository } from './equipment.repository';
import { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schemas';

@Injectable()
export class EquipmentService {
  constructor(private readonly equipmentRepository: EquipmentRepository) {}

  async listAvailableEquipment(): Promise<EquipmentResponse[]> {
    const equipmentItems = await this.equipmentRepository.findAvailable();
    return equipmentItems.map(mapEquipmentToResponse);
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
