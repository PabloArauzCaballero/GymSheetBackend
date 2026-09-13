import { Injectable } from '@nestjs/common';
import { DeviceTokenRepository } from './device-token.repository';
import { RegisterDeviceTokenInput, UnregisterDeviceTokenInput } from './device-token.schemas';

@Injectable()
export class DeviceTokenService {
  constructor(private readonly repository: DeviceTokenRepository) {}

  register(userId: string, input: RegisterDeviceTokenInput): Promise<void> {
    return this.repository.upsert(userId, input.platform, input.expoPushToken);
  }

  unregister(userId: string, input: UnregisterDeviceTokenInput): Promise<void> {
    return this.repository.deactivate(userId, input.expoPushToken);
  }
}
