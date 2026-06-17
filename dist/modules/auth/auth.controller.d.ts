import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AuthService } from './auth.service';
import { LoginInput, RegisterInput } from './auth.schemas';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(input: RegisterInput): Promise<{
        accessToken: string;
        tokenType: string;
        user: {
            id: string;
            email: string;
            nombreCompleto: string;
            rol: import("../../common/enums/domain.enums").UserRole;
        };
    }>;
    login(input: LoginInput): Promise<{
        accessToken: string;
        tokenType: string;
        user: {
            id: string;
            email: string;
            nombreCompleto: string;
            rol: import("../../common/enums/domain.enums").UserRole;
        };
    }>;
    getMe(currentUser: AuthenticatedUser): AuthenticatedUser;
}
