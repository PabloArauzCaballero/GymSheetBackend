import { ProfilesRepository } from './profiles.repository';
import { UpsertProfileInput } from './profiles.schemas';
export declare class ProfilesService {
    private readonly profilesRepository;
    constructor(profilesRepository: ProfilesRepository);
    getMyProfile(userId: string): Promise<import("./anthropometric-profile.model").AnthropometricProfileModel>;
    upsertMyProfile(userId: string, input: UpsertProfileInput): Promise<import("./anthropometric-profile.model").AnthropometricProfileModel>;
}
