import { UserModel } from './user.model';
export declare class UsersRepository {
    private readonly userModel;
    constructor(userModel: typeof UserModel);
    findById(id: string): Promise<UserModel | null>;
    findActiveById(id: string): Promise<UserModel | null>;
    findByEmail(email: string): Promise<UserModel | null>;
    createCliente(input: {
        email: string;
        passwordHash: string;
        nombreCompleto: string;
    }): Promise<UserModel>;
}
