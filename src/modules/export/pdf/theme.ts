/**
 * Identidad visual de los PDF de REPP.
 *
 * Los colores de marca replican `packages/design-tokens/src/tenants.ts` y
 * `index.ts` del monorepo de clientes (`GymSheetFrontend`): el backend no puede
 * importar ese paquete, así que si un acento cambia allí, cambia aquí. El
 * documento es claro (se imprime y se comparte con un entrenador externo); la
 * banda de cabecera usa la rampa oscura de la app.
 */

export type PdfBrand = {
  readonly id: string;
  /** Nombre visible en el pie y en los metadatos. */
  readonly name: string;
  /** Rótulo junto a la marca gráfica cuando no es REPP. */
  readonly wordmark: string;
  readonly monogram: string;
  readonly accent: string;
  readonly accentContrast: string;
  readonly accentInkOnDark: string;
  readonly accentInkOnLight: string;
};

const REPP_BRAND: PdfBrand = {
  id: 'gymsheet',
  name: 'REPP',
  wordmark: 'REPP',
  monogram: 'R',
  accent: '#2E8B7B',
  accentContrast: '#000000',
  accentInkOnDark: '#74CFBE',
  accentInkOnLight: '#22685D',
};

const BRANDS: Record<string, PdfBrand> = {
  [REPP_BRAND.id]: REPP_BRAND,
  topfitness: {
    id: 'topfitness',
    name: 'TOP Fitness Center',
    wordmark: 'TOP FITNESS',
    monogram: 'TF',
    accent: '#ED1B34',
    accentContrast: '#FFFFFF',
    accentInkOnDark: '#FF6B7D',
    accentInkOnLight: '#B3121F',
  },
};

/** Marca del gimnasio por id; sin coincidencia, REPP. */
export function resolvePdfBrand(tenantId: string | null | undefined): PdfBrand {
  const key = (tenantId ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(BRANDS, key) ? BRANDS[key] : REPP_BRAND;
}

export function isReppBrand(brand: PdfBrand): boolean {
  return brand.id === REPP_BRAND.id;
}

/** Mezcla un hex con blanco: `amount` 0 = blanco, 1 = el color. */
export function tint(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (value >> shift) & 0xff;
    return Math.round(255 - (255 - c) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** Superficies y tinta neutras (`lightColors` y rampa oscura de `colors`). */
export const PDF_COLORS = {
  page: '#FFFFFF',
  ink: '#18212B',
  muted: '#53616D',
  subtle: '#77838D',
  hairline: '#D6DEE5',
  zebra: '#F6F8FA',
  bandFrom: '#0B1220',
  bandTo: '#1E2C42',
  bandText: '#F5F8FA',
  bandMuted: '#B2BEC8',
  tableHead: '#162033',
  tableHeadText: '#E6EDF2',
} as const;

export type PdfTheme = {
  readonly brand: PdfBrand;
  readonly colors: typeof PDF_COLORS;
  /** Fondo de tarjetas: el acento casi disuelto en blanco. */
  readonly cardFill: string;
  /** Fila de grupo en tablas: un punto más de acento que la tarjeta. */
  readonly groupFill: string;
};

export function createPdfTheme(brand: PdfBrand): PdfTheme {
  return {
    brand,
    colors: PDF_COLORS,
    cardFill: tint(brand.accent, 0.06),
    groupFill: tint(brand.accent, 0.11),
  };
}

/** Geometría de página A4 en puntos. */
export const PAGE = {
  marginX: 40,
  coverBandHeight: 158,
  compactTop: 74,
  footerReserve: 64,
} as const;
