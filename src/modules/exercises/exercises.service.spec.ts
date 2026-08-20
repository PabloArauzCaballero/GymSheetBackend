import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ExerciseType } from '../../common/enums/domain.enums';
import { EquipmentRepository } from '../equipment/equipment.repository';
import { ExerciseModel } from './exercise.model';
import { ExercisesRepository } from './exercises.repository';
import { ExercisesService } from './exercises.service';

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const exerciseId = '00000000-0000-4000-8000-000000000003';

function createService(
  repositoryOverrides: Partial<ExercisesRepository>,
  sequelizeOverrides: Partial<Sequelize> = {},
  equipmentOverrides: Partial<EquipmentRepository> = {},
): ExercisesService {
  const exercisesRepository = repositoryOverrides as ExercisesRepository;
  const equipmentRepository = equipmentOverrides as EquipmentRepository;
  const sequelize = sequelizeOverrides as Sequelize;

  return new ExercisesService(exercisesRepository, equipmentRepository, sequelize);
}

describe('ExercisesService ownership', () => {
  it('hides exercises that are not visible to the requesting user', async () => {
    const service = createService({
      findVisibleById: jest.fn().mockResolvedValue(null),
    });

    await expect(service.getVisibleExerciseOrFail(exerciseId, ownerId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('prevents a user from modifying another user personal exercise', async () => {
    const exercise = {
      id: exerciseId,
      type: ExerciseType.PERSONAL,
      createdByUserId: otherUserId,
    } as ExerciseModel;
    const service = createService({
      findVisibleById: jest.fn().mockResolvedValue(exercise),
    });

    await expect(
      service.updatePersonalExercise(ownerId, exerciseId, { name: 'Updated name' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('prevents personal endpoints from modifying global exercises', async () => {
    const exercise = {
      id: exerciseId,
      type: ExerciseType.GLOBAL,
      createdByUserId: null,
    } as ExerciseModel;
    const service = createService({
      findVisibleById: jest.fn().mockResolvedValue(exercise),
    });

    await expect(service.inactivatePersonalExercise(ownerId, exerciseId)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('ExercisesService global catalogue', () => {
  it('reports a repeated catalogue name as a conflict, not a server error', async () => {
    // La unicidad la impone un índice parcial en la base de datos, así que el
    // choque llega como excepción de Sequelize y no como una comprobación
    // previa. Sin traducirlo, dar de alta dos veces el mismo ejercicio
    // respondía 500 y las siembras reejecutadas duplicaban el catálogo en
    // silencio.
    const service = createService(
      { createGlobal: jest.fn() },
      {
        transaction: jest
          .fn()
          .mockRejectedValue(
            new UniqueConstraintError({ errors: [], fields: { nombre: 'Press de banca' } }),
          ),
      },
      { findLinkableIds: jest.fn().mockResolvedValue([]) },
    );

    await expect(
      service.createGlobalExercise({ name: 'Press de banca', equipmentIds: [] } as never),
    ).rejects.toThrow(ConflictException);
  });
});
