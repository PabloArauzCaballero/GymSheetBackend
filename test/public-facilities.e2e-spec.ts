import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { env } from '../src/config/env';
import { FacilityStatus, RoomStatus, RoomType, EquipmentType } from '../src/common/enums/domain.enums';
import { BranchModel } from '../src/modules/facilities/branch.model';
import { RoomModel } from '../src/modules/facilities/room.model';
import { EquipmentAssignmentModel } from '../src/modules/facilities/equipment-assignment.model';
import { EquipmentModel } from '../src/modules/equipment/equipment.model';

/**
 * Directorio público de gimnasios (punto 14, Carril B): rutas sin sesión que
 * proyectan `facilities` de forma segura. Todo se siembra directo contra los
 * modelos (no hay flujo HTTP de alta para admin en los e2e de este repo).
 */
describe('Public facilities directory (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let branchModel: typeof BranchModel;
  let roomModel: typeof RoomModel;
  let equipmentModel: typeof EquipmentModel;
  let assignmentModel: typeof EquipmentAssignmentModel;

  function url(path: string): string {
    return `/${env.API_PREFIX}${path}`;
  }

  function unique(label: string): string {
    return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    application = moduleRef.createNestApplication({ bodyParser: false });
    application.setGlobalPrefix(env.API_PREFIX);
    application.use(requestIdMiddleware);
    application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    application.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
    application.useGlobalFilters(new HttpExceptionFilter());
    application.useGlobalInterceptors(new ResponseInterceptor());

    await application.init();
    httpServer = application.getHttpServer();
    branchModel = moduleRef.get(getModelToken(BranchModel));
    roomModel = moduleRef.get(getModelToken(RoomModel));
    equipmentModel = moduleRef.get(getModelToken(EquipmentModel));
    assignmentModel = moduleRef.get(getModelToken(EquipmentAssignmentModel));
  }, 60000);

  afterAll(async () => {
    await application?.close();
  });

  async function createBranch(
    label: string,
    overrides: Partial<{ status: FacilityStatus; description: string | null }> = {},
  ): Promise<BranchModel> {
    return branchModel.create({
      code: unique(`pub-${label}`),
      name: `Sede Pública ${label} ${unique('')}`,
      description: overrides.description ?? `Descripción de ${label}`,
      timeZone: env.BUSINESS_TIME_ZONE,
      status: overrides.status ?? FacilityStatus.ACTIVE,
      metadata: { secretInternalNote: 'nunca debe salir al público' },
    });
  }

  async function createRoom(
    branchId: string,
    roomType: RoomType,
    overrides: Partial<{ status: RoomStatus }> = {},
  ): Promise<RoomModel> {
    return roomModel.create({
      branchId,
      code: unique('room'),
      name: `Sala ${roomType}`,
      roomType,
      status: overrides.status ?? RoomStatus.ACTIVE,
    });
  }

  async function attachEquipment(roomId: string, name: string, type: EquipmentType): Promise<void> {
    const equipment = await equipmentModel.create({ name, type });
    await assignmentModel.create({ equipmentId: equipment.id, roomId });
  }

  it('lists only active branches, never inactive ones', async () => {
    const active = await createBranch('active');
    const inactive = await createBranch('inactive', { status: FacilityStatus.INACTIVE });

    const response = await request(httpServer).get(url('/public/facilities/branches')).expect(200);
    const ids = (response.body.data as Array<{ id: string }>).map((entry) => entry.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });

  it('never requires authentication', async () => {
    await request(httpServer).get(url('/public/facilities/branches')).expect(200);
  });

  it('never leaks metadata, internal codes, or non-public room types', async () => {
    const branch = await createBranch('metadata-check');
    await createRoom(branch.id, RoomType.CARDIO);
    await createRoom(branch.id, RoomType.STAFF);

    const response = await request(httpServer)
      .get(url(`/public/facilities/branches/${branch.id}`))
      .expect(200);
    const body = JSON.stringify(response.body.data);
    expect(body).not.toContain('secretInternalNote');
    expect(body).not.toContain(branch.code);
    expect(response.body.data.servicios).toContain('CARDIO');
    expect(response.body.data.servicios).not.toContain('STAFF');
    expect(
      (response.body.data.salas as Array<{ tipo: string }>).some((sala) => sala.tipo === 'STAFF'),
    ).toBe(false);
  });

  it('filters the directory by servicio (room type)', async () => {
    const withCardio = await createBranch('with-cardio');
    await createRoom(withCardio.id, RoomType.CARDIO);
    const withoutCardio = await createBranch('without-cardio');
    await createRoom(withoutCardio.id, RoomType.CLASSROOM);

    const response = await request(httpServer)
      .get(url('/public/facilities/branches?servicio=CARDIO&limit=50'))
      .expect(200);
    const ids = (response.body.data as Array<{ id: string }>).map((entry) => entry.id);
    expect(ids).toContain(withCardio.id);
    expect(ids).not.toContain(withoutCardio.id);
  });

  it('filters the directory by a search term against name and description', async () => {
    const marker = unique('marker');
    const matching = await createBranch(marker, { description: `Contiene ${marker} en la descripción` });
    const other = await createBranch('unrelated');

    const response = await request(httpServer)
      .get(url(`/public/facilities/branches?search=${marker}&limit=50`))
      .expect(200);
    const ids = (response.body.data as Array<{ id: string }>).map((entry) => entry.id);
    expect(ids).toContain(matching.id);
    expect(ids).not.toContain(other.id);
  });

  it('returns the equipment available at a branch in its detail view', async () => {
    const branch = await createBranch('equipment-check');
    const room = await createRoom(branch.id, RoomType.FUNCTIONAL);
    await attachEquipment(room.id, 'Kettlebell 16kg', EquipmentType.ACCESSORY);

    const response = await request(httpServer)
      .get(url(`/public/facilities/branches/${branch.id}`))
      .expect(200);
    expect(
      (response.body.data.equipamiento as Array<{ nombre: string }>).some(
        (item) => item.nombre === 'Kettlebell 16kg',
      ),
    ).toBe(true);
  });

  it('404s for an inactive branch instead of leaking that it exists', async () => {
    const inactive = await createBranch('detail-inactive', { status: FacilityStatus.INACTIVE });
    await request(httpServer).get(url(`/public/facilities/branches/${inactive.id}`)).expect(404);
  });

  it('404s for a branch id that does not exist', async () => {
    await request(httpServer)
      .get(url('/public/facilities/branches/00000000-0000-0000-0000-000000000000'))
      .expect(404);
  });
});
