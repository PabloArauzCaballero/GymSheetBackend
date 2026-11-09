import { getModelToken } from '@nestjs/sequelize';
import { AccessDirection, AccessDeviceStatus, FacilityStatus } from '../src/common/enums/domain.enums';
import { env } from '../src/config/env';
import { AccessDeviceModel } from '../src/modules/access-control/access-device.model';
import { AccessPointModel } from '../src/modules/facilities/access-point.model';
import { BranchModel } from '../src/modules/facilities/branch.model';
import { bootE2eApp, E2eApp } from './support/e2e-app';

/**
 * Dos reglas de alcance que el portal del gimnasio daba por hechas y el backend
 * no cumplía:
 *
 * 1. Un `ADMIN` sólo ve y opera los dispositivos de acceso de SU gimnasio. Antes
 *    `GET /admin/access/devices` devolvía los tornos de toda la plataforma y
 *    `PATCH .../status` podía apagar el de otro gimnasio.
 * 2. El catálogo global de ejercicios lo comparten todos los gimnasios, así que
 *    lo escribe `SYSTEM_ADMIN`, no el `ADMIN` de un gimnasio.
 */
describe('Alcance del administrador de gimnasio (e2e)', () => {
  let e2e: E2eApp;
  let admin: { token: string; id: string };
  let system: { token: string; id: string };
  const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const otherTenant = `otro-${tag}`;
  const ids = { ownPoint: '', otherPoint: '', ownDevice: '', otherDevice: '' };

  async function seedDevice(tenantId: string, label: string) {
    const branches = e2e.app.get<typeof BranchModel>(getModelToken(BranchModel));
    const points = e2e.app.get<typeof AccessPointModel>(getModelToken(AccessPointModel));
    const devices = e2e.app.get<typeof AccessDeviceModel>(getModelToken(AccessDeviceModel));
    const branch = await branches.create({
      tenantId,
      code: `${label}-${tag}`.toUpperCase(),
      name: `Sede ${label} ${tag}`,
      timeZone: 'America/La_Paz',
      status: FacilityStatus.ACTIVE,
      metadata: {},
    });
    const point = await points.create({
      branchId: branch.id,
      code: `P-${label}-${tag}`.toUpperCase(),
      name: `Torno ${label}`,
      allowedDirection: AccessDirection.BOTH,
      status: FacilityStatus.ACTIVE,
      metadata: {},
    });
    const device = await devices.create({
      accessPointId: point.id,
      adapterKey: 'e2e',
      externalDeviceId: `${label}-${tag}`,
      name: `Dispositivo ${label} ${tag}`,
      metadata: {},
    });
    return { pointId: point.id, deviceId: device.id };
  }

  beforeAll(async () => {
    e2e = await bootE2eApp();
    await e2e.sql(`INSERT INTO public.tenants (id, nombre) VALUES (:id, :id) ON CONFLICT DO NOTHING`, {
      id: otherTenant,
    });
    const own = await seedDevice(env.DEFAULT_TENANT_ID, 'propio');
    const other = await seedDevice(otherTenant, 'ajeno');
    ids.ownPoint = own.pointId;
    ids.ownDevice = own.deviceId;
    ids.otherPoint = other.pointId;
    ids.otherDevice = other.deviceId;

    admin = await e2e.register('scope-admin');
    await e2e.promote(admin.id, 'ADMIN');
    system = await e2e.register('scope-system');
    await e2e.promote(system.id, 'SYSTEM_ADMIN');
  }, 90000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  describe('dispositivos de acceso', () => {
    it('el ADMIN lista los de su gimnasio y no los de otro', async () => {
      const res = await e2e.as(admin.token).get('/admin/access/devices').expect(200);
      const listed = (res.body.data as Array<{ id: string }>).map((d) => d.id);
      expect(listed).toContain(ids.ownDevice);
      expect(listed).not.toContain(ids.otherDevice);
    });

    it('el SYSTEM_ADMIN sin suplantar ve los de todos', async () => {
      const res = await e2e.as(system.token).get('/admin/access/devices').expect(200);
      const listed = (res.body.data as Array<{ id: string }>).map((d) => d.id);
      expect(listed).toEqual(expect.arrayContaining([ids.ownDevice, ids.otherDevice]));
    });

    it('cambiar el estado de un dispositivo ajeno responde 404 y no lo toca', async () => {
      await e2e
        .as(admin.token)
        .patch(`/admin/access/devices/${ids.otherDevice}/status`)
        .send({ estado: AccessDeviceStatus.OFFLINE })
        .expect(404);
      const devices = e2e.app.get<typeof AccessDeviceModel>(getModelToken(AccessDeviceModel));
      const untouched = await devices.findByPk(ids.otherDevice);
      expect(untouched?.status).toBe(AccessDeviceStatus.ACTIVE);
    });

    it('cambiar el estado de uno propio sigue funcionando', async () => {
      await e2e
        .as(admin.token)
        .patch(`/admin/access/devices/${ids.ownDevice}/status`)
        .send({ estado: AccessDeviceStatus.MAINTENANCE })
        .expect(200);
    });

    it('registrar un dispositivo en un punto de acceso ajeno responde 404', async () => {
      await e2e
        .as(admin.token)
        .post('/admin/access/devices')
        .send({
          puntoAccesoId: ids.otherPoint,
          adapterKey: 'e2e',
          dispositivoExternoId: `intruso-${tag}`,
          nombre: 'Intruso',
        })
        .expect(404);
    });

    it('registrar uno en un punto propio responde 201', async () => {
      await e2e
        .as(admin.token)
        .post('/admin/access/devices')
        .send({
          puntoAccesoId: ids.ownPoint,
          adapterKey: 'e2e',
          dispositivoExternoId: `nuevo-${tag}`,
          nombre: `Nuevo ${tag}`,
        })
        .expect(201);
    });
  });

  describe('catálogo global de ejercicios', () => {
    it('el ADMIN de un gimnasio no puede crear ejercicios globales', async () => {
      await e2e
        .as(admin.token)
        .post('/admin/exercises/global')
        .send({ nombre: `Global prohibido ${tag}`, grupoMuscular: 'Hombros' })
        .expect(403);
    });

    it('el ADMIN tampoco puede lanzar la importación del dataset', async () => {
      await e2e.as(admin.token).get('/admin/exercises/import/exercises-dataset/status').expect(403);
    });

    it('el SYSTEM_ADMIN sí puede', async () => {
      await e2e
        .as(system.token)
        .post('/admin/exercises/global')
        .send({ nombre: `Global permitido ${tag}`, grupoMuscular: 'Hombros' })
        .expect(201);
    });
  });
});
