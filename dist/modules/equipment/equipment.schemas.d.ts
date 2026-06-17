import { z } from 'zod';
import { EquipmentStatus, EquipmentType } from '../../common/enums/domain.enums';
export declare const createEquipmentSchema: z.ZodObject<{
    nombre: z.ZodString;
    tipo: z.ZodNativeEnum<typeof EquipmentType>;
    descripcion: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    nombre: string;
    tipo: EquipmentType;
    descripcion?: string | null | undefined;
}, {
    nombre: string;
    tipo: EquipmentType;
    descripcion?: string | null | undefined;
}>;
export declare const updateEquipmentSchema: z.ZodObject<{
    nombre: z.ZodOptional<z.ZodString>;
    tipo: z.ZodOptional<z.ZodNativeEnum<typeof EquipmentType>>;
    descripcion: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
} & {
    estado: z.ZodOptional<z.ZodNativeEnum<typeof EquipmentStatus>>;
}, "strip", z.ZodTypeAny, {
    estado?: EquipmentStatus | undefined;
    nombre?: string | undefined;
    descripcion?: string | null | undefined;
    tipo?: EquipmentType | undefined;
}, {
    estado?: EquipmentStatus | undefined;
    nombre?: string | undefined;
    descripcion?: string | null | undefined;
    tipo?: EquipmentType | undefined;
}>;
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
