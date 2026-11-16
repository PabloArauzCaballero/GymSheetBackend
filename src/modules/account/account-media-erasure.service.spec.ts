import { MediaRetentionService } from '../media/media-retention.service';
import { AccountMediaErasureService } from './account-media-erasure.service';

describe('AccountMediaErasureService', () => {
  it('releases each key through the shared-reference check', async () => {
    const retention = {
      deleteRowAndUnreferencedFile: jest.fn()
        .mockResolvedValueOnce({ fileRemoved: true })
        .mockResolvedValueOnce({ fileRemoved: false }),
    };
    const service = new AccountMediaErasureService(retention as unknown as MediaRetentionService);
    await expect(service.erase({ storageKeys: ['users/a/perfiles/1.jpg', 'users/a/chats/c/2.bin'] })).resolves.toEqual({ removed: 1, kept: 1 });
    expect(retention.deleteRowAndUnreferencedFile).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed job so the outbox retries and dead-letters it', async () => {
    const service = new AccountMediaErasureService({} as MediaRetentionService);
    await expect(service.erase({ storageKeys: 'nope' })).rejects.toThrow();
  });
});
