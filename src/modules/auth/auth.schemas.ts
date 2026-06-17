import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(180).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(120),
  nombreCompleto: z.string().min(3).max(180),
});

export const loginSchema = z.object({
  email: z.string().email().max(180).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(120),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
