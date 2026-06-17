import { Injectable, NotFoundException } from '@nestjs/common';
import { EquipmentRepository } from './equipment.repository';
import { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schemas';

@Injectable()
export class EquipmentService {
  constructor(private readonly equipmentRepository: EquipmentRepository) {}

  listAvailableEquipment() {
    return this.equipmentRepository.findAvailable();
  }

  createEquipment(input: CreateEquipmentInput) {
    return this.equipmentRepository.create(input);
  }

  async updateEquipment(id: string, input: UpdateEquipmentInput) {
    const equipment = await this.equipmentRepository.update(id, input);

    if (!equipment) {
      throw new NotFoundException('Equipo no encontrado.');
    }

    return equipment;
  }

  async inactivateEquipment(id: string) {
    const equipment = await this.equipmentRepository.markInactive(id);

    if (!equipment) {
      throw new NotFoundException('Equipo no encontrado.');
    }

    return equipment;
  }
}
