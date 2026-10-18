/**
 * Catálogo de premios de muestra para TEST (P1, 2026-10-18).
 *
 * Solo lo siembra el seeder de demostración, nunca la siembra base: un
 * gimnasio real no puede amanecer prometiendo batidos que no ha decidido dar.
 * Cubre los tres tipos de hito para que la app tenga algo que enseñar en
 * «Mis premios» y en la carta de premio.
 *
 * `MAQUINA` es el código de rango compartido por las tres ramas (neutra,
 * masculina y femenina): un premio de rango se ata a un código, y con un
 * código común alcanza a todos.
 */
export type ShowcasePrize = {
  targetKind: 'BADGE' | 'LEVEL' | 'PERFECT_WEEK';
  targetCode: string;
  title: string;
  description: string;
  instructions: string;
  icon: string;
  validDays: number | null;
  stock: number | null;
};

export const SHOWCASE_PRIZES: readonly ShowcasePrize[] = [
  {
    targetKind: 'BADGE',
    targetCode: 'RACHA_7',
    title: 'Batido de proteína gratis',
    description: 'Siete días seguidos merecen algo más que una insignia.',
    instructions: 'Enséñalo en recepción y elige el sabor.',
    icon: 'nutrition-outline',
    validDays: 30,
    stock: null,
  },
  {
    targetKind: 'BADGE',
    targetCode: 'RACHA_30',
    title: 'Pase de un día para un amigo',
    description: 'Trae a alguien a entrenar contigo, invita la casa.',
    instructions: 'Tu amigo lo enseña en recepción el día que venga contigo.',
    icon: 'people-outline',
    validDays: 60,
    stock: null,
  },
  {
    targetKind: 'LEVEL',
    targetCode: 'MAQUINA',
    title: '10 % en la mensualidad',
    description: 'Llegar a Máquina tiene premio: un mes más barato.',
    instructions: 'Enséñalo en recepción al pagar tu próxima mensualidad.',
    icon: 'pricetag-outline',
    validDays: 45,
    stock: null,
  },
  {
    targetKind: 'PERFECT_WEEK',
    targetCode: 'SEMANA_REDONDA',
    title: 'Toalla REPP',
    description: 'Tres retos de tres. Llévate la toalla del gimnasio.',
    instructions: 'Recógela en recepción mientras queden.',
    icon: 'gift-outline',
    validDays: 30,
    stock: 50,
  },
];
