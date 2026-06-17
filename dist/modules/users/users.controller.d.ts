import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { UsersService } from './users.service';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    getMyUser(currentUser: AuthenticatedUser): Promise<{
        id: string;
        email: string;
        nombreCompleto: string;
        rol: import("../../common/enums/domain.enums").UserRole;
        estado: import("../../common/enums/domain.enums").UserStatus;
        fechaRegistro: Date;
    }>;
}
