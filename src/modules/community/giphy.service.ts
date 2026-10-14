import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { GifSearchQuery } from './community.schemas';

export type GifItem = {
  id: string;
  titulo: string;
  url: string;
  vistaPreviaUrl: string;
  ancho: number;
  alto: number;
};

const PAGE = 24;

type GiphyImage = { url?: string; width?: string; height?: string };
type GiphyResult = {
  id: string;
  title?: string;
  images?: { fixed_width?: GiphyImage; fixed_width_small?: GiphyImage; original?: GiphyImage };
};

/** Busca GIFs y stickers en GIPHY (clasificación PG-13) para el selector de comentarios. */
@Injectable()
export class GiphyService {
  private readonly logger = new Logger(GiphyService.name);

  get enabled(): boolean {
    return Boolean(env.GIPHY_API_KEY);
  }

  async search(query: GifSearchQuery): Promise<{ items: GifItem[]; siguiente: number | null; disponible: boolean }> {
    if (!env.GIPHY_API_KEY) return { items: [], siguiente: null, disponible: false };
    const base = `https://api.giphy.com/v1/${query.tipo}/${query.q ? 'search' : 'trending'}`;
    const params = new URLSearchParams({
      api_key: env.GIPHY_API_KEY,
      limit: String(PAGE),
      offset: String(query.pos),
      rating: 'pg-13',
      lang: 'es',
      bundle: 'messaging_non_clips',
    });
    if (query.q) params.set('q', query.q);
    try {
      const res = await fetch(`${base}?${params}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`GIPHY ${res.status}`);
      const body = (await res.json()) as { data?: GiphyResult[] };
      const items = (body.data ?? []).flatMap((g): GifItem[] => {
        const full = g.images?.fixed_width ?? g.images?.original;
        const preview = g.images?.fixed_width_small ?? full;
        if (!full?.url || !preview?.url) return [];
        return [
          {
            id: g.id,
            titulo: g.title ?? '',
            url: full.url,
            vistaPreviaUrl: preview.url,
            ancho: Number(full.width) || 200,
            alto: Number(full.height) || 200,
          },
        ];
      });
      return { items, siguiente: items.length === PAGE ? query.pos + PAGE : null, disponible: true };
    } catch (error) {
      this.logger.warn(`GIPHY no respondió: ${(error as Error).message}`);
      return { items: [], siguiente: null, disponible: false };
    }
  }
}
