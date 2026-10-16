import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import {
  MusicPlaylistPage,
  MusicPlaylistResponse,
  decodePlaylistCursor,
  encodePlaylistCursor,
  mapPlaylistRow,
} from './music.mapper';
import { MusicRepository } from './music.repository';
import { CreatePlaylistInput, PlaylistListQuery, UpdatePlaylistInput } from './music.schemas';
import { SpotifyOEmbedClient } from './spotify-oembed.client';
import { ParsedSpotifyUrl, parseSpotifyEmbedUrl, parseSpotifyUrl } from './spotify-url';

type Actor = { id: string; tenantId: string };

export const DEFAULT_PLAYLIST_TITLE = 'Playlist de Spotify';
const MAX_STORED_TITLE = 120;

function duplicate(): DomainException {
  return new DomainException(
    HttpStatus.CONFLICT,
    'MUSIC_PLAYLIST_DUPLICATE',
    'Ya guardaste este enlace de Spotify.',
  );
}

/** Playlists de la comunidad: solo enlaces a Spotify, públicos o privados. */
@Injectable()
export class MusicService {
  constructor(
    private readonly repository: MusicRepository,
    private readonly oembed: SpotifyOEmbedClient,
  ) {}

  async list(actor: Actor, query: PlaylistListQuery): Promise<MusicPlaylistPage> {
    const cursor = query.cursor ? decodePlaylistCursor(query.cursor) : null;
    if (query.cursor && !cursor) throw new BadRequestException('El cursor no es válido.');
    const rows =
      query.scope === 'private'
        ? await this.repository.listPrivate(actor.id, cursor, query.limit + 1)
        : await this.repository.listPublic(actor.id, cursor, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => mapPlaylistRow(row, actor.id)),
      nextCursor: rows.length > query.limit && last ? encodePlaylistCursor(last) : null,
    };
  }

  async create(actor: Actor, input: CreatePlaylistInput): Promise<MusicPlaylistResponse> {
    const parsed = parseSpotifyUrl(input.url);
    if (!parsed) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        'MUSIC_URL_INVALID',
        'El enlace no es de Spotify. Pega un enlace de open.spotify.com o spotify.link a una playlist, álbum, canción, artista o podcast.',
      );
    }
    // Comprobación barata antes de salir a Spotify; el índice único sigue
    // siendo quien decide si llegan dos a la vez.
    if (await this.repository.existsForUser(actor.id, parsed.url)) throw duplicate();

    const { target, title, imageUrl } = await this.describe(parsed);
    if (target.url !== parsed.url && (await this.repository.existsForUser(actor.id, target.url))) {
      throw duplicate();
    }
    try {
      const created = await this.repository.create({
        userId: actor.id,
        tenantId: actor.tenantId,
        url: target.url,
        tipo: target.tipo,
        titulo: input.titulo ?? title ?? DEFAULT_PLAYLIST_TITLE,
        imagenUrl: imageUrl,
        visibilidad: input.visibilidad,
      });
      return this.responseFor(created.id, actor.id);
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw duplicate();
      throw error;
    }
  }

  async update(actor: Actor, id: string, input: UpdatePlaylistInput): Promise<MusicPlaylistResponse> {
    const playlist = await this.ownedOrFail(id, actor.id);
    const changes = {
      ...(input.visibilidad ? { visibilidad: input.visibilidad } : {}),
      ...(input.titulo ? { titulo: input.titulo } : {}),
    };
    if (Object.keys(changes).length > 0) await this.repository.update(playlist, changes);
    return this.responseFor(playlist.id, actor.id);
  }

  async remove(actor: Actor, id: string): Promise<{ deleted: true }> {
    await this.repository.delete(await this.ownedOrFail(id, actor.id));
    return { deleted: true };
  }

  /**
   * Título y portada desde oEmbed. Un enlace corto se resuelve a su forma
   * canónica si Spotify devuelve el `iframe_url`; si no, se guarda tal cual.
   */
  private async describe(parsed: ParsedSpotifyUrl) {
    const embed = await this.oembed.fetch(parsed.url);
    const resolved = parsed.id ? null : parseSpotifyEmbedUrl(embed?.iframeUrl);
    return {
      target: resolved ?? parsed,
      title: embed?.title ? embed.title.slice(0, MAX_STORED_TITLE) : null,
      imageUrl: embed?.thumbnailUrl ?? null,
    };
  }

  /** Ajeno o inexistente: 404 igual, para no confirmar ids de otros. */
  private async ownedOrFail(id: string, userId: string) {
    const playlist = await this.repository.findOwned(id, userId);
    if (!playlist) throw new NotFoundException('No encontramos esa playlist.');
    return playlist;
  }

  private async responseFor(id: string, viewerId: string): Promise<MusicPlaylistResponse> {
    const row = await this.repository.findRow(id);
    if (!row) throw new NotFoundException('No encontramos esa playlist.');
    return mapPlaylistRow(row, viewerId);
  }
}
