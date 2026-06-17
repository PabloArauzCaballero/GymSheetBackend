import { UsersRepository } from './users.repository';
import { UserModel } from './user.model';
export declare class UsersService {
    private readonly usersRepository;
    constructor(usersRepository: UsersRepository);
    getActiveUserOrFail(userId: string): Promise<UserModel>;
}
