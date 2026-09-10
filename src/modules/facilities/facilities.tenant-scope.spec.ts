import { UnprocessableEntityException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import {
  EquipmentStatus,
  MaintenanceStatus,
  UserRole,
} from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { EquipmentModel } from '../equipment/equipment.model';
import { EquipmentRepository } from '../equipment/equipment.repository';
import { DomainEventPublisher } from '../integration/domain-event.publisher';
import { BranchModel } from './branch.model';
import { FacilitiesRepository } from './facilities.repository';
import { FacilitiesService } from './facilities.service';

/**
 * La fuga que cierran estas pruebas se veía desde la consola: un administrador
 * listaba «sus» sedes y aparecían las de otro gimnasio. El listado era sólo la
 * mitad visible — por el mismo hueco se podía renombrar una sede ajena o
 * programarle mantenimiento a una máquina que no era suya.
 */
describe('FacilitiesRepository — alcance por gimnasio', () => {
  function repositoryWithSpies() {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    const findAll = jest.fn().mockResolvedValue([]);
    const findOne = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({});
    const model = { findAndCountAll, findAll, findOne, create };
    // Se construye sin pasar por el constructor: sólo interesan los modelos que
    // consultan estos métodos.
    const repository = Object.create(
      FacilitiesRepository.prototype,
    ) as FacilitiesRepository;
    (repository as any).branches = model;
    (repository as any).rooms = model;
    (repository as any).accessPoints = model;
    (repository as any).maintenance = model;
    return { repository, findAndCountAll, findAll, findOne, create };
  }

  function includeOf(call: Record<string, unknown>, model: unknown) {
    const includes = call.include as Array<Record<string, unknown>>;
    return includes.find((entry) => entry.model === model);
  }

  it('acota las sedes al gimnasio del actor', async () => {
    const { repository, findAndCountAll } = repositoryWithSpies();

    await repository.listBranches({ page: 1, pageSize: 25 }, 'topfitness');

    expect(findAndCountAll.mock.calls[0][0]).toMatchObject({
      where: { tenantId: 'topfitness' },
    });
  });

  it('no filtra las sedes cuando el alcance es toda la plataforma', async () => {
    const { repository, findAndCountAll } = repositoryWithSpies();

    await repository.listBranches({ page: 1, pageSize: 25 }, null);

    expect(findAndCountAll.mock.calls[0][0]).toMatchObject({ where: {} });
  });

  it('busca una sede por id y gimnasio, no por clave primaria', async () => {
    const { repository, findOne } = repositoryWithSpies();

    await repository.findBranch('branch-1', 'topfitness');

    expect(findOne.mock.calls[0][0]).toMatchObject({
      where: { id: 'branch-1', tenantId: 'topfitness' },
    });
  });

  it('crea la sede en el gimnasio indicado', async () => {
    const { repository, create } = repositoryWithSpies();

    await repository.createBranch(
      {
        code: 'CENTRO',
        name: 'Centro',
        description: null,
        timeZone: 'America/La_Paz',
        metadata: {},
      },
      'topfitness',
    );

    expect(create.mock.calls[0][0]).toMatchObject({ tenantId: 'topfitness' });
  });

  it.each([
    [
      'salas',
      (repository: FacilitiesRepository) =>
        repository.listRooms(undefined, { page: 1, pageSize: 25 }, 'topfitness'),
    ],
    [
      'una sala concreta',
      (repository: FacilitiesRepository) =>
        repository.findRoom('room-1', 'topfitness'),
    ],
    [
      'puntos de acceso',
      (repository: FacilitiesRepository) =>
        repository.listAccessPoints(undefined, 'topfitness'),
    ],
    [
      'un punto de acceso concreto',
      (repository: FacilitiesRepository) =>
        repository.findAccessPoint('access-1', 'topfitness'),
    ],
  ])('acota %s por la sede a la que pertenecen', async (_name, act) => {
    const { repository, findAndCountAll, findAll, findOne } =
      repositoryWithSpies();

    await act(repository);

    const call = (findAndCountAll.mock.calls[0] ??
      findAll.mock.calls[0] ??
      findOne.mock.calls[0])[0] as Record<string, unknown>;
    // `required: true` es lo que convierte el include en filtro: sin él el JOIN
    // sería externo y la fila ajena saldría igual.
    expect(includeOf(call, BranchModel)).toMatchObject({
      required: true,
      where: { tenantId: 'topfitness' },
    });
  });

  it('acota el mantenimiento por el gimnasio del equipo intervenido', async () => {
    const { repository, findAndCountAll } = repositoryWithSpies();

    await repository.listMaintenance({ page: 1, pageSize: 25 }, 'topfitness');

    expect(includeOf(findAndCountAll.mock.calls[0][0], EquipmentModel)).toMatchObject(
      { required: true, where: { tenantId: 'topfitness' } },
    );
  });
});

describe('FacilitiesService — equipo de otro gimnasio', () => {
  const actor: AuthenticatedUser = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'admin@topfitness.test',
    role: UserRole.ADMIN,
    tenantId: 'topfitness',
    tenantScope: 'topfitness',
    impersonating: false,
  };

  function createService(
    repositoryOverrides: Partial<FacilitiesRepository>,
    equipmentOverrides: Partial<EquipmentRepository>,
  ) {
    return {
      service: new FacilitiesService(
        repositoryOverrides as FacilitiesRepository,
        equipmentOverrides as EquipmentRepository,
        { record: jest.fn() } as unknown as DomainEventPublisher,
        {
          transaction: (work: (transaction: unknown) => unknown) =>
            work({ LOCK: { UPDATE: 'UPDATE' } }),
        } as unknown as Sequelize,
      ),
    };
  }

  const foreignEquipment = {
    id: 'equipment-1',
    tenantId: 'gimnasio-vecino',
    status: EquipmentStatus.AVAILABLE,
  } as EquipmentModel;

  it('no deja programar mantenimiento sobre un equipo ajeno', async () => {
    const { service } = createService(
      { createMaintenance: jest.fn() },
      { findById: jest.fn().mockResolvedValue(foreignEquipment) },
    );

    await expect(
      service.scheduleMaintenance(actor, {
        equipmentId: 'equipment-1',
        maintenanceType: 'PREVENTIVE',
        scheduledFor: '2026-01-01',
        description: 'Revisión',
        vendorName: null,
        technicianName: null,
        metadata: {},
      } as never),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('no muta el equipo ajeno al iniciar un mantenimiento suyo', async () => {
    const update = jest.fn();
    const { service } = createService(
      {
        findMaintenance: jest.fn().mockResolvedValue({
          id: 'maintenance-1',
          equipmentId: 'equipment-1',
          status: MaintenanceStatus.SCHEDULED,
        }),
        updateMaintenance: jest.fn(),
      },
      { findById: jest.fn().mockResolvedValue(foreignEquipment), update },
    );

    await expect(
      service.startMaintenance(actor, 'maintenance-1'),
    ).rejects.toThrow(UnprocessableEntityException);
    // La comprobación va antes de escribir: el equipo del vecino no puede
    // quedarse marcado «en mantenimiento» por una petición que acaba en error.
    expect(update).not.toHaveBeenCalled();
  });
});
