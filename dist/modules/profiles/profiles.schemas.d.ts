import { z } from 'zod';
import { TrainingGoal } from '../../common/enums/domain.enums';
export declare const upsertProfileSchema: z.ZodObject<{
    edad: z.ZodNumber;
    pesoKg: z.ZodNumber;
    estaturaCm: z.ZodNumber;
    objetivo: z.ZodNativeEnum<typeof TrainingGoal>;
}, "strip", z.ZodTypeAny, {
    edad: number;
    pesoKg: number;
    estaturaCm: number;
    objetivo: TrainingGoal;
}, {
    edad: number;
    pesoKg: number;
    estaturaCm: number;
    objetivo: TrainingGoal;
}>;
export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;
