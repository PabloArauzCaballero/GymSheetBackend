import { z } from 'zod';
export declare const registerSchema: z.ZodObject<{
    email: z.ZodEffects<z.ZodString, string, string>;
    password: z.ZodString;
    nombreCompleto: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    nombreCompleto: string;
    password: string;
}, {
    email: string;
    nombreCompleto: string;
    password: string;
}>;
export declare const loginSchema: z.ZodObject<{
    email: z.ZodEffects<z.ZodString, string, string>;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
