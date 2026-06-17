import { JwtService } from '@nestjs/jwt';
import { UsersRepository } from '../users/users.repository';
import { LoginInput, RegisterInput } from './auth.schemas';
export declare class AuthService {
    private readonly usersRepository;
    private readonly jwtService;
    constructor(usersRepository: UsersRepository, jwtService: JwtService);
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
    private buildAuthResponse;
}
