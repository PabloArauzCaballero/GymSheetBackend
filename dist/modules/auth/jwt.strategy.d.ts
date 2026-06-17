import { Strategy } from 'passport-jwt';
import { AuthenticatedUser, JwtPayload } from '../../common/types/auth-context.types';
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    constructor();
    validate(payload: JwtPayload): AuthenticatedUser;
}
export {};
