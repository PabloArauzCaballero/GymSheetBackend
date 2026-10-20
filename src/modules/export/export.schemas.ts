import { z } from 'zod';

export const routineProgressExportQuerySchema = z.object({
  format: z.enum(['csv', 'excel', 'pdf', 'CSV', 'EXCEL', 'PDF']).default('excel'),
  routineId: z.string().uuid().or(z.literal('ALL')).optional().default('ALL'),
  datePreset: z.enum(['ALL', 'LAST_30', 'LAST_90', 'LAST_YEAR']).optional().default('ALL'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  includeHistory: z.coerce.boolean().optional().default(true),
  includeTargets: z.coerce.boolean().optional().default(true),
  includePrograms: z.coerce.boolean().optional().default(true),
});

export type RoutineProgressExportQuery = z.infer<typeof routineProgressExportQuerySchema>;

export const routineProgressExportBodySchema = z.object({
  format: z.enum(['csv', 'excel', 'pdf', 'CSV', 'EXCEL', 'PDF']).default('excel'),
  routineId: z.string().optional().default('ALL'),
  datePreset: z.enum(['ALL', 'LAST_30', 'LAST_90', 'LAST_YEAR']).optional().default('ALL'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  includeHistory: z.boolean().optional().default(true),
  includeTargets: z.boolean().optional().default(true),
  includePrograms: z.boolean().optional().default(true),
});

export type RoutineProgressExportBody = z.infer<typeof routineProgressExportBodySchema>;
