import { AnthropometricProfileModel } from './anthropometric-profile.model';
import { UpsertProfileInput } from './profiles.schemas';
export declare class ProfilesRepository {
    private readonly profileModel;
    constructor(profileModel: typeof AnthropometricProfileModel);
    findByUserId(usuarioId: string): Promise<AnthropometricProfileModel | null>;
    upsertByUserId(usuarioId: string, input: UpsertProfileInput): Promise<AnthropometricProfileModel>;
}
