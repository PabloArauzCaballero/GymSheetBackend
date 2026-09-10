import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { EquipmentResponse, mapEquipmentToResponse } from './equipment.mapper';
import { EquipmentRepository } from './equipment.repository';
import { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schemas';

@Injectable()
export class EquipmentService {
  constructor(private readonly equipmentRepository: EquipmentRepository) {}

  /**
   * Catalogo que ve un socio: el de SU gimnasio.
   *
   * Se acota por `tenantId` y no por `tenantScope` a proposito. El alcance
   * administrativo de un administrador de plataforma es «todos los gimnasios»,
   * pero esta ruta la abre cualquier socio para ver que maquinas tiene a mano:
   * devolverle el inventario de otras sedes no seria una fuga grave, seria una
   * respuesta sin sentido.
   */
  async listAvailableEquipment(user: AuthenticatedUser): Promise<EquipmentResponse[]> {
    const equipmentItems = await this.equipmentRepository.findAvailable(user.tenantId);
    return equipmentItems.map(mapEquipmentToResponse);
  }

  async createEquipment(
    actor: AuthenticatedUser,
    input: CreateEquipmentInput,
  ): Promise<EquipmentResponse> {
    const equipment = await this.equipmentRepository.create(input, actor.tenantId);
    return mapEquipmentToResponse(equipment);
  }

  async updateEquipment(
    actor: AuthenticatedUser,
    equipmentId: string,
    input: UpdateEquipmentInput,
  ): Promise<EquipmentResponse> {
    await this.requireInScope(actor, equipmentId);
    const equipment = await this.equipmentRepository.update(equipmentId, input);

    if (!equipment) {
      throw new NotFoundException('Equipo no encontrado.');
    }

    return mapEquipmentToResponse(equipment);
  }

  async inactivateEquipment(
    actor: AuthenticatedUser,
    equipmentId: string,
  ): Promise<EquipmentResponse> {
    await this.requireInScope(actor, equipmentId);
    const equipment = await this.equipmentRepository.markInactive(equipmentId);

    if (!equipment) {
      throw new NotFoundException('Equipo no encontrado.');
    }

    return mapEquipmentToResponse(equipment);
  }

  /**
   * Un equipo de otro gimnasio se responde como inexistente: el identificador
   * de la ruta no puede servir para averiguar que inventario tiene el vecino.
   */
  private async requireInScope(
    actor: AuthenticatedUser,
    equipmentId: string,
  ): Promise<void> {
    if (actor.tenantScope === null) return;
    const equipment = await this.equipmentRepository.findById(equipmentId);
    if (!equipment || equipment.tenantId !== actor.tenantScope) {
      throw new NotFoundException('Equipo no encontrado.');
    }
  }
}
