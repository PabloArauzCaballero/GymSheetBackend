import { z } from "zod";
import {
  EmploymentStatus,
  MembershipStatus,
  PlanStatus,
  PlanType,
  StaffPosition,
  UserRole,
} from "../../common/enums/domain.enums";

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => JSON.stringify(value).length <= 16384,
    "Los metadatos no pueden superar 16 KiB.",
  );

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const scopeSchema = z.object({
  sedeId: z.string().uuid(),
  salaId: z.string().uuid().nullable().optional(),
});

export const membershipListSchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  estado: z.nativeEnum(MembershipStatus).optional(),
});

/**
 * Atributos comerciales del plan. Se declaran una sola vez porque alta y
 * edición los comparten: la tabla `membership.plans` ya persiste precio,
 * moneda, beneficios, orden, disponibilidad e `image_file_id`, pero ningún
 * contrato de escritura los exponía, de modo que sólo podían fijarse por
 * semilla. `imagenId` referencia un archivo de `media.files` — es el punto de
 * anclaje del QR de cobro propio de cada plan.
 */
const commercialPlanFields = {
  precio: z.number().nonnegative().max(99_999_999).nullable().optional(),
  moneda: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .toUpperCase()
    .nullable()
    .optional(),
  beneficios: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  orden: z.number().int().min(0).max(9999).optional(),
  disponibleNuevo: z.boolean().optional(),
  disponibleRenovacion: z.boolean().optional(),
  disponibleExtension: z.boolean().optional(),
  imagenId: z.string().uuid().nullable().optional(),
};

type CommercialPlanInput = {
  precio?: number | null;
  moneda?: string | null;
  beneficios?: string[];
  orden?: number;
  disponibleNuevo?: boolean;
  disponibleRenovacion?: boolean;
  disponibleExtension?: boolean;
  imagenId?: string | null;
};

/** Sólo emite las columnas comerciales realmente presentes en la petición. */
function mapCommercialPlanInput(input: CommercialPlanInput) {
  return {
    ...(input.precio !== undefined
      ? { priceAmount: input.precio === null ? null : input.precio.toFixed(2) }
      : {}),
    ...(input.moneda !== undefined ? { currency: input.moneda } : {}),
    ...(input.beneficios !== undefined
      ? { benefits: [...new Set(input.beneficios)] }
      : {}),
    ...(input.orden !== undefined ? { displayOrder: input.orden } : {}),
    ...(input.disponibleNuevo !== undefined
      ? { availableNew: input.disponibleNuevo }
      : {}),
    ...(input.disponibleRenovacion !== undefined
      ? { availableRenewal: input.disponibleRenovacion }
      : {}),
    ...(input.disponibleExtension !== undefined
      ? { availableExtension: input.disponibleExtension }
      : {}),
    ...(input.imagenId !== undefined ? { imageFileId: input.imagenId } : {}),
  };
}

export const createPlanSchema = z
  .object({
    codigo: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[A-Za-z0-9._-]+$/),
    nombre: z.string().trim().min(2).max(180),
    descripcion: z.string().trim().max(2000).nullable().optional(),
    tipo: z.nativeEnum(PlanType),
    duracionDias: z.number().int().min(1).max(3650),
    diasRecordatorio: z
      .array(z.number().int().min(0).max(3650))
      .max(30)
      .default([7, 3, 1, 0]),
    alcances: z.array(scopeSchema).min(1).max(100),
    metadata: metadataSchema.default({}),
    ...commercialPlanFields,
  })
  // Un importe sin moneda no es representable en el modelo de cobro.
  .superRefine((input, context) => {
    if (input.precio !== undefined && input.precio !== null && !input.moneda) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["moneda"],
        message: "Un plan con precio requiere moneda.",
      });
    }
  })
  .transform((input) => ({
    code: input.codigo.toUpperCase(),
    name: input.nombre,
    description: input.descripcion ?? null,
    planType: input.tipo,
    durationDays: input.duracionDias,
    reminderDays: [...new Set(input.diasRecordatorio)].sort((a, b) => b - a),
    scopes: input.alcances.map((scope) => ({
      branchId: scope.sedeId,
      roomId: scope.salaId ?? null,
    })),
    metadata: input.metadata,
    ...mapCommercialPlanInput(input),
  }));

export const updatePlanSchema = z
  .object({
    nombre: z.string().trim().min(2).max(180).optional(),
    descripcion: z.string().trim().max(2000).nullable().optional(),
    tipo: z.nativeEnum(PlanType).optional(),
    duracionDias: z.number().int().min(1).max(3650).optional(),
    diasRecordatorio: z
      .array(z.number().int().min(0).max(3650))
      .max(30)
      .optional(),
    estado: z.nativeEnum(PlanStatus).optional(),
    metadata: metadataSchema.optional(),
    ...commercialPlanFields,
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined))
  .transform((input) => ({
    ...(input.nombre !== undefined ? { name: input.nombre } : {}),
    ...(input.descripcion !== undefined
      ? { description: input.descripcion }
      : {}),
    ...(input.tipo !== undefined ? { planType: input.tipo } : {}),
    ...(input.duracionDias !== undefined
      ? { durationDays: input.duracionDias }
      : {}),
    ...(input.diasRecordatorio !== undefined
      ? {
          reminderDays: [...new Set(input.diasRecordatorio)].sort(
            (a, b) => b - a,
          ),
        }
      : {}),
    ...(input.estado !== undefined ? { status: input.estado } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...mapCommercialPlanInput(input),
  }));

export const replacePlanScopesSchema = z
  .object({ alcances: z.array(scopeSchema).min(1).max(100) })
  .transform((input) => ({
    scopes: input.alcances.map((scope) => ({
      branchId: scope.sedeId,
      roomId: scope.salaId ?? null,
    })),
  }));

export const createCustomerSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(180)
      .transform((value) => value.toLowerCase()),
    /**
     * Opcional a propósito.
     *
     * Quien da de alta en recepción no debería inventar contraseñas: acaba
     * poniendo la misma para todos, o una que el cliente nunca recibe. Si no
     * llega ninguna, el servidor genera una y se la manda por correo a la
     * persona, con la recomendación de cambiarla. Se acepta igualmente para no
     * romper a quien ya integraba este endpoint.
     */
    password: z.string().min(10).max(128).optional(),
    pinAcceso: z.string().regex(/^\d{4,12}$/),
    nombreCompleto: z.string().trim().min(3).max(180),
    numeroCliente: z.string().trim().min(2).max(80),
    telefono: z.string().trim().min(5).max(40).nullable().optional(),
    referenciaExterna: z.string().trim().min(1).max(180).nullable().optional(),
    notas: z.string().trim().max(2000).nullable().optional(),
    metadata: metadataSchema.default({}),
  })
  .strict()
  .transform((input) => ({
    email: input.email,
    password: input.password,
    accessPin: input.pinAcceso,
    fullName: input.nombreCompleto,
    customerNumber: input.numeroCliente.toUpperCase(),
    phoneNumber: input.telefono ?? null,
    externalReference: input.referenciaExterna ?? null,
    notes: input.notas ?? null,
    metadata: input.metadata,
  }));

export const createMembershipSchema = z
  .object({
    clienteUsuarioId: z.string().uuid(),
    planId: z.string().uuid(),
    iniciaEl: z.string().date().optional(),
    referenciaExterna: z.string().trim().min(1).max(180).nullable().optional(),
    notas: z.string().trim().max(2000).nullable().optional(),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    userId: input.clienteUsuarioId,
    planId: input.planId,
    startsOn: input.iniciaEl,
    externalReference: input.referenciaExterna ?? null,
    notes: input.notas ?? null,
    metadata: input.metadata,
  }));

export const membershipStatusSchema = z
  .object({
    estado: z.nativeEnum(MembershipStatus),
    motivo: z.string().trim().max(2000).nullable().optional(),
  })
  .transform((input) => ({
    status: input.estado,
    reason: input.motivo ?? null,
  }));

export const membershipIntentSchema = z.object({
  planId: z.string().uuid(),
  months: z.number().int().min(1).max(24).default(1),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const createStaffSchema = z
  .object({
    usuarioId: z.string().uuid(),
    cargo: z.nativeEnum(StaffPosition),
    contratadoEl: z.string().date(),
    accesoIlimitado: z.boolean().default(true),
    sedes: z.array(z.string().uuid()).min(1).max(100),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    userId: input.usuarioId,
    position: input.cargo,
    hiredOn: input.contratadoEl,
    unlimitedAccess: input.accesoIlimitado,
    branchIds: [...new Set(input.sedes)],
    metadata: input.metadata,
  }));

/**
 * El cargo laboral determina el rol de autorización de la cuenta: no se acepta
 * un rol suelto para evitar que un alta de personal pueda emitir permisos que
 * no correspondan a su puesto.
 */
const staffRoleByPosition: Record<StaffPosition, UserRole> = {
  [StaffPosition.COACH]: UserRole.COACH,
  [StaffPosition.FRONT_DESK]: UserRole.FRONT_DESK,
  [StaffPosition.ADMINISTRATION]: UserRole.ADMIN,
};

/**
 * Alta completa de una persona del equipo: cuenta de acceso y perfil laboral
 * en una sola operación. Antes sólo existía `createStaffSchema`, que exige un
 * `usuarioId` previo sin ningún endpoint que permitiera crearlo, de modo que
 * dar de alta un entrenador desde la consola era imposible.
 */
export const createStaffUserSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(180)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(10).max(128),
    nombreCompleto: z.string().trim().min(3).max(180),
    cargo: z.nativeEnum(StaffPosition),
    contratadoEl: z.string().date(),
    accesoIlimitado: z.boolean().default(true),
    sedes: z.array(z.string().uuid()).min(1).max(100),
    // Opcional: sin PIN la persona entra por credencial biométrica o tarjeta.
    pinAcceso: z
      .string()
      .regex(/^\d{4,12}$/)
      .nullable()
      .optional(),
    metadata: metadataSchema.default({}),
  })
  .strict()
  .transform((input) => ({
    email: input.email,
    password: input.password,
    fullName: input.nombreCompleto,
    role: staffRoleByPosition[input.cargo],
    position: input.cargo,
    hiredOn: input.contratadoEl,
    unlimitedAccess: input.accesoIlimitado,
    branchIds: [...new Set(input.sedes)],
    accessPin: input.pinAcceso ?? null,
    metadata: input.metadata,
  }));

export const staffListSchema = paginationSchema.extend({
  cargo: z.nativeEnum(StaffPosition).optional(),
  estadoLaboral: z.nativeEnum(EmploymentStatus).optional(),
});

export const updateStaffStatusSchema = z
  .object({
    estadoLaboral: z.nativeEnum(EmploymentStatus),
    terminadoEl: z.string().date().nullable().optional(),
  })
  .transform((input) => ({
    employmentStatus: input.estadoLaboral,
    terminatedOn: input.terminadoEl ?? null,
  }));

export type MembershipListInput = z.infer<typeof membershipListSchema>;
export const createFeatureSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[A-Z][A-Z0-9_]*$/, "El código debe ser UPPER_SNAKE_CASE."),
    name: z.string().trim().min(2).max(180),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const updateFeatureSchema = z
  .object({
    name: z.string().trim().min(2).max(180).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.status !== undefined,
    "Envía al menos un campo.",
  );

export type CreateFeatureInput = z.infer<typeof createFeatureSchema>;
export type UpdateFeatureInput = z.infer<typeof updateFeatureSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type ReplacePlanScopesInput = z.infer<typeof replacePlanScopesSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreateMembershipInput = z.infer<typeof createMembershipSchema>;
export type MembershipStatusInput = z.infer<typeof membershipStatusSchema>;
export type MembershipIntentInput = z.infer<typeof membershipIntentSchema>;
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type CreateStaffUserInput = z.infer<typeof createStaffUserSchema>;
export type StaffListInput = z.infer<typeof staffListSchema>;
export type UpdateStaffStatusInput = z.infer<typeof updateStaffStatusSchema>;

/**
 * Petición de activación por pago fuera de la aplicación.
 *
 * La nota es opcional y corta a propósito: sirve para «pagué en recepción el
 * martes», no para abrir una conversación. La conversación ya ocurre en el
 * WhatsApp que este botón abre.
 */
export const activationRequestSchema = z.object({
  nota: z.string().trim().max(280).nullable().optional(),
});

/** Confirmación del administrador: sólo hay que elegir el plan. */
export const activationConfirmSchema = z.object({
  planId: z.string().uuid(),
});

export type ActivationRequestInput = z.infer<typeof activationRequestSchema>;
export type ActivationConfirmInput = z.infer<typeof activationConfirmSchema>;
