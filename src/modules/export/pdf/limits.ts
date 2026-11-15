import { formatNumber } from './format';

/**
 * Tope de series dibujadas en un PDF. El informe se arma de forma síncrona en
 * memoria: sin tope, 1000 sesiones o 20 000 filas daban cientos de páginas y
 * segundos de CPU por petición. El resumen sigue contando todo; las tablas de
 * detalle se cortan aquí y el detalle completo queda en el CSV o el Excel.
 */
export const MAX_PDF_SETS = 1500;

/** Presupuesto compartido de series entre todas las tablas de un informe. */
export class SetBudget {
  private used = 0;

  constructor(readonly limit = MAX_PDF_SETS) {}

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  take(count: number): number {
    const granted = Math.min(count, this.remaining);
    this.used += granted;
    return granted;
  }
}

export function truncationNote(shown: number, total: number, unit: string, download: string): string {
  return (
    `Este PDF muestra como mucho ${formatNumber(MAX_PDF_SETS)} series: aquí se incluyen ${formatNumber(shown)} ` +
    `de ${formatNumber(total)} ${unit}. El detalle completo está en la descarga en ${download}.`
  );
}
