import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { decodePlaylistCursor, encodePlaylistCursor } from './music.mapper';
import { MusicRepository, PlaylistRow } from './music.repository';
import { DEFAULT_PLAYLIST_TITLE, MusicService } from './music.service';
import { SpotifyOEmbed, SpotifyOEmbedClient } from './spotify-oembed.client';

const ACTOR = { id: '11111111-1111-4111-8111-111111111111', tenantId: 'gym-a' };
const OTHER = '22222222-2222-4222-8222-222222222222';
const ID = '37i9dQZF1DXcBWIGoYBM5M';
const PLAYLIST_ID = '33333333-3333-4333-8333-333333333333';

function row(overrides: Partial<PlaylistRow> = {}): PlaylistRow {
  return {
    id: PLAYLIST_ID,
    user_id: ACTOR.id,
    url: `https://open.spotify.com/playlist/${ID}`,
    tipo: 'playlist',
    titulo: 'Leg day',
    imagen_url: null,
    visibilidad: 'PUBLIC',
    created_at: new Date('2026-10-15T10:00:00.123Z'),
    cursor_ts: '2026-10-15T10:00:00.123456Z',
    full_name: 'Ana María Pérez',
    photo_url: 'https://cdn.example/ana.jpg',
    ...overrides,
  };
}

function setup(embed: SpotifyOEmbed | null = null) {
  const repository = {
    existsForUser: jest.fn().mockResolvedValue(false),
    create: jest.fn().mockResolvedValue({ id: PLAYLIST_ID }),
    findRow: jest.fn().mockResolvedValue(row()),
    findOwned: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    listPublic: jest.fn().mockResolvedValue([]),
    listPrivate: jest.fn().mockResolvedValue([]),
  };
  const oembed = { fetch: jest.fn().mockResolvedValue(embed) };
  const service = new MusicService(
    repository as unknown as MusicRepository,
    oembed as unknown as SpotifyOEmbedClient,
  );
  return { service, repository, oembed };
}

async function expectDomainError(promise: Promise<unknown>, status: HttpStatus, code: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).getStatus()).toBe(status);
  expect((error as DomainException).code).toBe(code);
}

describe('MusicService.create', () => {
  it('rechaza enlaces que no son de Spotify con MUSIC_URL_INVALID sin llamar a oEmbed', async () => {
    const { service, oembed, repository } = setup();
    await expectDomainError(
      service.create(ACTOR, { url: 'https://youtube.com/watch?v=x', visibilidad: 'PUBLIC' }),
      HttpStatus.BAD_REQUEST,
      'MUSIC_URL_INVALID',
    );
    expect(oembed.fetch).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('guarda la url normalizada con título y portada de oEmbed', async () => {
    const { service, repository, oembed } = setup({
      title: 'Beast Mode',
      thumbnailUrl: 'https://i.scdn.co/image/x',
      iframeUrl: null,
    });
    const response = await service.create(ACTOR, {
      url: `https://open.spotify.com/intl-es/playlist/${ID}?si=abc`,
      visibilidad: 'PUBLIC',
    });
    expect(oembed.fetch).toHaveBeenCalledWith(`https://open.spotify.com/playlist/${ID}`);
    expect(repository.create).toHaveBeenCalledWith({
      userId: ACTOR.id,
      tenantId: ACTOR.tenantId,
      url: `https://open.spotify.com/playlist/${ID}`,
      tipo: 'playlist',
      titulo: 'Beast Mode',
      imagenUrl: 'https://i.scdn.co/image/x',
      visibilidad: 'PUBLIC',
    });
    expect(response).toEqual({
      id: PLAYLIST_ID,
      url: `https://open.spotify.com/playlist/${ID}`,
      tipo: 'playlist',
      titulo: 'Leg day',
      imagenUrl: null,
      visibilidad: 'PUBLIC',
      esMia: true,
      creadaEn: '2026-10-15T10:00:00.123Z',
      autor: { id: ACTOR.id, displayName: 'Ana M.', avatarUrl: 'https://cdn.example/ana.jpg' },
    });
  });

  it('el título del body manda sobre el de oEmbed', async () => {
    const { service, repository } = setup({ title: 'De Spotify', thumbnailUrl: null, iframeUrl: null });
    await service.create(ACTOR, { url: `https://open.spotify.com/album/${ID}`, visibilidad: 'PRIVATE', titulo: 'Mía' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'Mía', tipo: 'album' }));
  });

  it('si oEmbed falla usa el título por defecto e imagen nula', async () => {
    const { service, repository } = setup(null);
    await service.create(ACTOR, { url: `https://open.spotify.com/track/${ID}`, visibilidad: 'PUBLIC' });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ titulo: DEFAULT_PLAYLIST_TITLE, imagenUrl: null }),
    );
  });

  it('enlace corto: se guarda tal cual si oEmbed no lo resuelve', async () => {
    const { service, repository } = setup(null);
    await service.create(ACTOR, { url: 'https://spotify.link/AbC123', visibilidad: 'PUBLIC' });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://spotify.link/AbC123', tipo: 'playlist' }),
    );
  });

  it('enlace corto: se normaliza si oEmbed devuelve el iframe_url', async () => {
    const { service, repository } = setup({
      title: 'Álbum',
      thumbnailUrl: null,
      iframeUrl: `https://open.spotify.com/embed/album/${ID}?utm_source=oembed`,
    });
    await service.create(ACTOR, { url: 'https://spotify.link/AbC123', visibilidad: 'PUBLIC' });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: `https://open.spotify.com/album/${ID}`, tipo: 'album' }),
    );
  });

  it('duplicado detectado antes de insertar → 409 MUSIC_PLAYLIST_DUPLICATE', async () => {
    const { service, repository, oembed } = setup();
    repository.existsForUser.mockResolvedValue(true);
    await expectDomainError(
      service.create(ACTOR, { url: `https://open.spotify.com/playlist/${ID}`, visibilidad: 'PUBLIC' }),
      HttpStatus.CONFLICT,
      'MUSIC_PLAYLIST_DUPLICATE',
    );
    expect(oembed.fetch).not.toHaveBeenCalled();
  });

  it('carrera contra el índice único → 409, no 500', async () => {
    const { service, repository } = setup();
    repository.create.mockRejectedValue(new UniqueConstraintError({}));
    await expectDomainError(
      service.create(ACTOR, { url: `https://open.spotify.com/playlist/${ID}`, visibilidad: 'PUBLIC' }),
      HttpStatus.CONFLICT,
      'MUSIC_PLAYLIST_DUPLICATE',
    );
  });
});

describe('MusicService.list', () => {
  it('pagina con limit+1 y emite un cursor que se puede decodificar', async () => {
    const { service, repository } = setup();
    const rows = [row({ id: 'a1111111-1111-4111-8111-111111111111' }), row({ id: 'b1111111-1111-4111-8111-111111111111' }), row({ id: 'c1111111-1111-4111-8111-111111111111' })];
    repository.listPublic.mockResolvedValue(rows);
    const page = await service.list(ACTOR, { scope: 'public', limit: 2 });
    expect(repository.listPublic).toHaveBeenCalledWith(ACTOR.id, null, 3);
    expect(page.items.map((item) => item.id)).toEqual([rows[0].id, rows[1].id]);
    expect(page.nextCursor).toBe(encodePlaylistCursor(rows[1]));
    expect(decodePlaylistCursor(page.nextCursor!)).toEqual({ ts: rows[1].cursor_ts, id: rows[1].id });

    await service.list(ACTOR, { scope: 'public', limit: 2, cursor: page.nextCursor! });
    expect(repository.listPublic).toHaveBeenLastCalledWith(ACTOR.id, { ts: rows[1].cursor_ts, id: rows[1].id }, 3);
  });

  it('última página: nextCursor null; esMia según el autor', async () => {
    const { service, repository } = setup();
    repository.listPublic.mockResolvedValue([row({ user_id: OTHER })]);
    const page = await service.list(ACTOR, { scope: 'public', limit: 20 });
    expect(page.nextCursor).toBeNull();
    expect(page.items[0].esMia).toBe(false);
  });

  it('scope=private solo consulta las del propio usuario', async () => {
    const { service, repository } = setup();
    await service.list(ACTOR, { scope: 'private', limit: 20 });
    expect(repository.listPrivate).toHaveBeenCalledWith(ACTOR.id, null, 21);
    expect(repository.listPublic).not.toHaveBeenCalled();
  });

  it('cursor manipulado → 400', async () => {
    const { service } = setup();
    await expect(service.list(ACTOR, { scope: 'public', limit: 20, cursor: 'basura' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('MusicService update/remove', () => {
  it('ajena o inexistente → 404', async () => {
    const { service, repository } = setup();
    await expect(service.update(ACTOR, PLAYLIST_ID, { titulo: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(ACTOR, PLAYLIST_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findOwned).toHaveBeenCalledWith(PLAYLIST_ID, ACTOR.id);
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('la dueña cambia visibilidad y título', async () => {
    const { service, repository } = setup();
    const owned = { id: PLAYLIST_ID };
    repository.findOwned.mockResolvedValue(owned);
    repository.findRow.mockResolvedValue(row({ visibilidad: 'PRIVATE', titulo: 'Nuevo' }));
    const response = await service.update(ACTOR, PLAYLIST_ID, { visibilidad: 'PRIVATE', titulo: 'Nuevo' });
    expect(repository.update).toHaveBeenCalledWith(owned, { visibilidad: 'PRIVATE', titulo: 'Nuevo' });
    expect(response).toEqual(expect.objectContaining({ visibilidad: 'PRIVATE', titulo: 'Nuevo' }));
  });

  it('la dueña borra', async () => {
    const { service, repository } = setup();
    const owned = { id: PLAYLIST_ID };
    repository.findOwned.mockResolvedValue(owned);
    await expect(service.remove(ACTOR, PLAYLIST_ID)).resolves.toEqual({ deleted: true });
    expect(repository.delete).toHaveBeenCalledWith(owned);
  });
});
