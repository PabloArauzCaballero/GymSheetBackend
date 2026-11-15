# export

Exportación del historial y del progreso de rutinas para la persona y su entrenador externo.

- `GET /export/workout-history` (JSON), `/csv` y `/pdf` (`repp-avance.pdf`).
- `POST /export/routine-progress` en Excel, CSV o PDF (`repp-progreso-rutinas-AAAA-MM-DD.*`), con auditoría.

## PDF (`pdf/`)

El servicio solo reúne los datos; el dibujo vive en `pdf/`:

| Archivo | Qué hace |
|---|---|
| `theme.ts` | Marca REPP y de cada gimnasio (copia de `packages/design-tokens/src/tenants.ts`), colores y geometría. |
| `fonts.ts`, `fonts/` | Bricolage Grotesque e Instrument Sans (SIL OFL 1.1). Sin los .ttf en `dist/`, cae a Helvetica con aviso `export.pdf_fonts_missing`. |
| `brand-mark.ts` | Signo y logotipo REPP en vectorial (copia de `apps/mobile/src/components/brand/mark.ts`). |
| `document.ts` | Documento, metadatos y cursor de página (`PdfLayout`). |
| `header.ts`, `footer.ts` | Banda de portada, cabecera compacta y pie con «Página X de Y». |
| `section.ts`, `kpi.ts`, `table.ts` | Títulos, tarjetas, cifras clave, barras y tablas paginadas sin filas partidas. |
| `*.stats.ts`, `*.rows.ts`, `*.pdf.ts` | Cálculo, filas de tabla y dibujo de cada informe. Fechas y semanas en `env.BUSINESS_TIME_ZONE`. |
| `limits.ts` | Tope de 1.500 series dibujadas por PDF (síncrono); el resumen cuenta todo y el PDF avisa del recorte. |

Para que la tipografía de marca llegue a producción, `nest-cli.json` debe copiar
`modules/export/pdf/fonts/**` como asset de `nest build`.
