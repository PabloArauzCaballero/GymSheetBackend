import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ProfilesService } from './profiles.service';
import { UpsertProfileInput } from './profiles.schemas';
export declare class ProfilesController {
    private readonly profilesService;
    constructor(profilesService: ProfilesService);
    getMyProfile(currentUser: AuthenticatedUser): Promise<import("./anthropometric-profile.model").AnthropometricProfileModel>;
    createMyProfile(currentUser: AuthenticatedUser, input: UpsertProfileInput): Promise<import("./anthropometric-profile.model").AnthropometricProfileModel>;
    updateMyProfile(currentUser: AuthenticatedUser, input: UpsertProfileInput): Promise<import("./anthropometric-profile.model").AnthropometricProfileModel>;
}
