import { PENDING_REVIEW_SUSPENSION_UNTIL } from '../../common/moderation/account-suspension';
import { SanctionStatusRepository } from './sanction-status.repository';
import { publicSanctionReason, SanctionStatusService } from './sanction-status.service';

const userId = '00000000-0000-4000-8000-000000000001';

function build(suspension: string | null, ban: string | null) {
  const repository = {
    runningSuspensionReason: jest.fn().mockResolvedValue(suspension),
    banReason: jest.fn().mockResolvedValue(ban),
  };
  return { service: new SanctionStatusService(repository as unknown as SanctionStatusRepository), repository };
}

describe('SanctionStatusService', () => {
  it('names the reason of the running suspension strike, with the words of the moderation notice', async () => {
    const { service, repository } = build('ACOSO', null);
    await expect(service.suspensionReason(userId, new Date(Date.now() + 86_400_000))).resolves.toEqual({
      code: 'ACOSO',
      label: 'Acoso',
      text: 'mensajes o contenido que hostigan o intimidan a otra persona',
    });
    expect(repository.runningSuspensionReason).toHaveBeenCalledWith(userId, expect.any(Date));
  });

  it('reads the open-ended suspension as the minor report it always is', async () => {
    const { service, repository } = build(null, null);
    await expect(service.suspensionReason(userId, PENDING_REVIEW_SUSPENSION_UNTIL)).resolves.toMatchObject({ code: 'MENOR_DE_EDAD' });
    expect(repository.runningSuspensionReason).not.toHaveBeenCalled();
  });

  it('falls back to OTRO for a suspension without a strike or an unknown code', async () => {
    await expect(build(null, null).service.suspensionReason(userId, new Date(Date.now() + 1000))).resolves.toMatchObject({ code: 'OTRO' });
    expect(publicSanctionReason('NO_SUCH_REASON')).toMatchObject({ code: 'OTRO', label: 'Otro incumplimiento' });
  });

  it('answers the ban reason only for a banned account', async () => {
    await expect(build(null, 'SPAM').service.banReason(userId)).resolves.toMatchObject({ code: 'SPAM', label: 'Spam' });
    await expect(build(null, null).service.banReason(userId)).resolves.toBeNull();
  });
});
