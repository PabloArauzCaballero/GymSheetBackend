import { NotFoundException } from '@nestjs/common';
import { TrainingGoal } from '../../common/enums/domain.enums';
import { ProfilesRepository } from './profiles.repository';
import { ProfilesService } from './profiles.service';

const userId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const profileInput = { age: 30, weightKg: 75, heightCm: 180, goal: TrainingGoal.HYPERTROPHY };

const storedProfile = {
  id: '00000000-0000-4000-8000-000000000010',
  userId,
  heightCm: 175,
  weightKg: 72,
  updatedAt: new Date('2026-07-19T10:00:00.000Z'),
};

function createService(overrides: Partial<ProfilesRepository>): ProfilesService {
  return new ProfilesService(overrides as ProfilesRepository);
}

describe('ProfilesService', () => {
  it('returns the profile belonging to the requesting user', async () => {
    const service = createService({
      findByUserId: jest.fn().mockResolvedValue(storedProfile),
    });

    await expect(service.getMyProfile(userId)).resolves.toMatchObject({ id: storedProfile.id });
  });

  it('reports a missing profile rather than returning an empty object', async () => {
    const service = createService({ findByUserId: jest.fn().mockResolvedValue(null) });

    await expect(service.getMyProfile(userId)).rejects.toThrow(NotFoundException);
  });

  it('scopes the lookup to the authenticated user', async () => {
    // The identifier must come from the token, never from client input; this
    // asserts the service forwards exactly what it was given.
    const findByUserId = jest.fn().mockResolvedValue(storedProfile);
    const service = createService({ findByUserId });

    await service.getMyProfile(userId);

    expect(findByUserId).toHaveBeenCalledWith(userId);
    expect(findByUserId).not.toHaveBeenCalledWith(otherUserId);
  });

  it('scopes the upsert to the authenticated user', async () => {
    const upsertByUserId = jest.fn().mockResolvedValue(storedProfile);
    const service = createService({ upsertByUserId });

    await service.upsertMyProfile(userId, profileInput);

    expect(upsertByUserId).toHaveBeenCalledWith(userId, profileInput);
  });

  it('returns the persisted profile after an upsert', async () => {
    const service = createService({
      upsertByUserId: jest.fn().mockResolvedValue(storedProfile),
    });

    await expect(
      service.upsertMyProfile(userId, profileInput),
    ).resolves.toMatchObject({ id: storedProfile.id });
  });
});
