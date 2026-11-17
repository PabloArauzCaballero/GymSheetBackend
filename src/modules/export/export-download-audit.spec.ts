import { createHmac } from 'node:crypto';
import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { withIpHashSecret } from '../../common/privacy/testing/with-ip-hash-secret';
import { EquipmentService } from '../equipment/equipment.service';
import { ProfilesService } from '../profiles/profiles.service';
import { UsersService } from '../users/users.service';
import { WorkoutsService } from '../workouts/workouts.service';
import { ExportService } from './export.service';
import { RoutineProgressDownloadAuditModel } from './routine-progress-download-audit.model';

const actor = { id: '00000000-0000-4000-8000-000000000001', role: UserRole.COACH } as AuthenticatedUser;
const secret = 'unit-download-audit-ip-secret-0123456789';

describe('ExportService.recordRoutineProgressDownloadAudit', () => {
  function build() {
    const create = jest.fn().mockResolvedValue(undefined);
    const service = new ExportService(
      {} as UsersService,
      {} as ProfilesService,
      {} as EquipmentService,
      {} as WorkoutsService,
      undefined,
      { create } as unknown as typeof RoutineProgressDownloadAuditModel,
    );
    return { service, create };
  }

  const details = { format: 'CSV' as const, filters: {}, fileName: 'p.csv', recordsCount: 3, ip: '203.0.113.7', userAgent: 'ua' };

  it('stores the keyed hash of the client IP, never the address', async () => {
    const { service, create } = build();
    await withIpHashSecret(secret, () => service.recordRoutineProgressDownloadAudit(actor, details));
    const row = create.mock.calls[0][0] as Record<string, unknown>;
    expect(row.ipHmac).toBe(createHmac('sha256', secret).update('203.0.113.7').digest('hex'));
    expect(row).not.toHaveProperty('ip');
    expect(JSON.stringify(row)).not.toContain('203.0.113.7');
  });

  it('stores no IP evidence when the deployment has no hash secret', async () => {
    const { service, create } = build();
    await withIpHashSecret(undefined, () => service.recordRoutineProgressDownloadAudit(actor, details));
    expect(create.mock.calls[0][0]).toMatchObject({ ipHmac: null });
  });
});
