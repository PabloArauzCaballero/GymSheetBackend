import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { json, urlencoded } from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { requestIdMiddleware } from "../src/common/middleware/request-id.middleware";
import { env } from "../src/config/env";
import { SpotifyOEmbed, SpotifyOEmbedClient } from "../src/modules/music/spotify-oembed.client";

/** Ids base62 de 22 caracteres distintos en cada corrida: la base de e2e se reutiliza. */
function spotifyId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 22 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

type Playlist = {
  id: string;
  url: string;
  tipo: string;
  titulo: string;
  imagenUrl: string | null;
  visibilidad: "PUBLIC" | "PRIVATE";
  esMia: boolean;
  creadaEn: string;
  autor: { id: string; displayName: string; avatarUrl: string | null };
};

describe("music playlists API (PostgreSQL integration)", () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let anaToken: string;
  let anaId: string;
  let beaToken: string;
  let beaId: string;
  let caroToken: string;
  const url = (path: string) => `/${env.API_PREFIX}${path}`;
  // oEmbed sustituido: el e2e no depende de la red ni de Spotify.
  const oembed: { fetch: jest.Mock<Promise<SpotifyOEmbed | null>, [string]> } = {
    fetch: jest.fn(async (_url: string): Promise<SpotifyOEmbed | null> => ({ title: "Beast Mode", thumbnailUrl: "https://i.scdn.co/image/abc", iframeUrl: null })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SpotifyOEmbedClient)
      .useValue(oembed)
      .compile();
    application = moduleRef.createNestApplication({ bodyParser: false });
    application.setGlobalPrefix(env.API_PREFIX);
    application.use(requestIdMiddleware);
    application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    application.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
    application.useGlobalFilters(new HttpExceptionFilter());
    application.useGlobalInterceptors(new ResponseInterceptor());
    await application.init();
    httpServer = application.getHttpServer();

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const register = (name: string) =>
      request(httpServer).post(url("/auth/register")).send({
        email: `music-${name}-${suffix}@example.test`,
        password: "music-qa-password",
        nombreCompleto: `QA Música ${name}`,
        acceptedTerms: true,
      }).expect(201);
    const [ana, bea, caro] = await Promise.all([register("ana"), register("bea"), register("caro")]);
    anaToken = ana.body.data.accessToken as string;
    anaId = ana.body.data.user.id as string;
    beaToken = bea.body.data.accessToken as string;
    beaId = bea.body.data.user.id as string;
    caroToken = caro.body.data.accessToken as string;
  }, 60000);

  afterAll(async () => { await application?.close(); });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const listAll = async (token: string, scope: "public" | "private"): Promise<Playlist[]> => {
    const items: Playlist[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `scope=${scope}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await request(httpServer).get(url(`/music/playlists?${query}`)).set(as(token)).expect(200);
      items.push(...(res.body.data.items as Playlist[]));
      cursor = res.body.data.nextCursor as string | null;
    } while (cursor);
    return items;
  };

  it("exige autenticación", async () => {
    await request(httpServer).get(url("/music/playlists")).expect(401);
  });

  it("crea pública y privada; la privada no se filtra a otra persona; duplicado 409; borrar ajeno 404", async () => {
    const publicId = spotifyId();
    const privateId = spotifyId();

    const created = await request(httpServer).post(url("/music/playlists")).set(as(anaToken))
      .send({ url: `https://open.spotify.com/intl-es/playlist/${publicId}?si=xyz`, visibilidad: "PUBLIC" })
      .expect(201);
    const publica = created.body.data as Playlist;
    expect(publica).toEqual({
      id: expect.any(String),
      url: `https://open.spotify.com/playlist/${publicId}`,
      tipo: "playlist",
      titulo: "Beast Mode",
      imagenUrl: "https://i.scdn.co/image/abc",
      visibilidad: "PUBLIC",
      esMia: true,
      creadaEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      autor: { id: anaId, displayName: "QA M.", avatarUrl: null },
    });
    expect(oembed.fetch).toHaveBeenCalledWith(`https://open.spotify.com/playlist/${publicId}`);

    oembed.fetch.mockResolvedValueOnce(null);
    const privateRes = await request(httpServer).post(url("/music/playlists")).set(as(anaToken))
      .send({ url: `https://open.spotify.com/album/${privateId}`, visibilidad: "PRIVATE" })
      .expect(201);
    const privada = privateRes.body.data as Playlist;
    expect(privada).toEqual(expect.objectContaining({
      tipo: "album", visibilidad: "PRIVATE", titulo: "Playlist de Spotify", imagenUrl: null,
    }));

    // Ana ve su pública en `public` y su privada en `private`.
    const anaPublic = await listAll(anaToken, "public");
    expect(anaPublic.map((p) => p.id)).toContain(publica.id);
    expect(anaPublic.map((p) => p.id)).not.toContain(privada.id);
    const anaPrivate = await listAll(anaToken, "private");
    expect(anaPrivate.map((p) => p.id)).toEqual([privada.id]);

    // Bea ve la pública de Ana (sin ser suya) y jamás la privada.
    const beaPublic = await listAll(beaToken, "public");
    const seenByBea = beaPublic.find((p) => p.id === publica.id);
    expect(seenByBea).toEqual(expect.objectContaining({ esMia: false, autor: expect.objectContaining({ id: anaId }) }));
    expect(beaPublic.map((p) => p.id)).not.toContain(privada.id);
    expect(await listAll(beaToken, "private")).toEqual([]);

    // Duplicado: mismo usuario + misma url normalizada, aunque llegue con otra forma.
    const dup = await request(httpServer).post(url("/music/playlists")).set(as(anaToken))
      .send({ url: `https://open.spotify.com/playlist/${publicId}`, visibilidad: "PRIVATE" })
      .expect(409);
    expect(dup.body.code).toBe("MUSIC_PLAYLIST_DUPLICATE");
    // Otra persona sí puede guardar el mismo enlace.
    await request(httpServer).post(url("/music/playlists")).set(as(beaToken))
      .send({ url: `https://open.spotify.com/playlist/${publicId}`, visibilidad: "PRIVATE" })
      .expect(201);

    // Ajeno → 404 al editar y al borrar; sigue existiendo.
    await request(httpServer).delete(url(`/music/playlists/${publica.id}`)).set(as(beaToken)).expect(404);
    await request(httpServer).delete(url(`/music/playlists/${privada.id}`)).set(as(beaToken)).expect(404);
    await request(httpServer).patch(url(`/music/playlists/${privada.id}`)).set(as(beaToken))
      .send({ visibilidad: "PUBLIC" }).expect(404);
    expect((await listAll(anaToken, "private")).map((p) => p.id)).toEqual([privada.id]);

    // La dueña la hace pública y le cambia el título.
    const patched = await request(httpServer).patch(url(`/music/playlists/${privada.id}`)).set(as(anaToken))
      .send({ visibilidad: "PUBLIC", titulo: "Pierna" }).expect(200);
    expect(patched.body.data).toEqual(expect.objectContaining({ visibilidad: "PUBLIC", titulo: "Pierna" }));
    expect((await listAll(beaToken, "public")).map((p) => p.id)).toContain(privada.id);

    // La dueña borra: 200 { deleted: true } y desaparece.
    const removed = await request(httpServer).delete(url(`/music/playlists/${privada.id}`)).set(as(anaToken)).expect(200);
    expect(removed.body.data).toEqual({ deleted: true });
    expect((await listAll(beaToken, "public")).map((p) => p.id)).not.toContain(privada.id);
  });

  it("rechaza enlaces que no son de Spotify con MUSIC_URL_INVALID", async () => {
    for (const bad of ["https://www.youtube.com/watch?v=abc", "http://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "hola"]) {
      const res = await request(httpServer).post(url("/music/playlists")).set(as(anaToken))
        .send({ url: bad, visibilidad: "PUBLIC" }).expect(400);
      expect(res.body.code).toBe("MUSIC_URL_INVALID");
    }
    await request(httpServer).post(url("/music/playlists")).set(as(anaToken))
      .send({ url: "https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M", visibilidad: "OTRA" }).expect(400);
    await request(httpServer).post(url("/music/playlists")).set(as(anaToken))
      .send({ url: "https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M", visibilidad: "PUBLIC", titulo: "x".repeat(121) })
      .expect(400);
  });

  it("pagina por cursor sin repetir ni saltar", async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(httpServer).post(url("/music/playlists")).set(as(caroToken))
        .send({ url: `https://open.spotify.com/track/${spotifyId()}`, visibilidad: "PRIVATE", titulo: `T${i}` })
        .expect(201);
    }
    const first = await request(httpServer).get(url("/music/playlists?scope=private&limit=2")).set(as(caroToken)).expect(200);
    expect(first.body.data.items).toHaveLength(2);
    expect(first.body.data.nextCursor).toEqual(expect.any(String));
    const second = await request(httpServer)
      .get(url(`/music/playlists?scope=private&limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor as string)}`))
      .set(as(caroToken)).expect(200);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.nextCursor).toBeNull();
    const titles = [...first.body.data.items, ...second.body.data.items].map((p: Playlist) => p.titulo);
    expect(titles).toEqual(["T2", "T1", "T0"]);
    await request(httpServer).get(url("/music/playlists?scope=private&cursor=no-es-un-cursor")).set(as(caroToken)).expect(400);
    await request(httpServer).get(url("/music/playlists?limit=51")).set(as(caroToken)).expect(400);
  });

  it("el bloqueo oculta las públicas en ambos sentidos", async () => {
    const fromBea = await request(httpServer).post(url("/music/playlists")).set(as(beaToken))
      .send({ url: `https://open.spotify.com/artist/${spotifyId()}`, visibilidad: "PUBLIC" }).expect(201);
    const fromCaro = await request(httpServer).post(url("/music/playlists")).set(as(caroToken))
      .send({ url: `https://open.spotify.com/artist/${spotifyId()}`, visibilidad: "PUBLIC" }).expect(201);
    const beaPlaylist = (fromBea.body.data as Playlist).id;
    const caroPlaylist = (fromCaro.body.data as Playlist).id;
    expect((await listAll(caroToken, "public")).map((p) => p.id)).toContain(beaPlaylist);
    expect((await listAll(beaToken, "public")).map((p) => p.id)).toContain(caroPlaylist);

    await request(httpServer).post(url("/me/blocks")).set(as(caroToken)).send({ targetUserId: beaId }).expect(201);

    const caroView = (await listAll(caroToken, "public")).map((p) => p.id);
    expect(caroView).not.toContain(beaPlaylist);
    expect(caroView).toContain(caroPlaylist);
    const beaView = (await listAll(beaToken, "public")).map((p) => p.id);
    expect(beaView).not.toContain(caroPlaylist);
    expect(beaView).toContain(beaPlaylist);
  });

  it("se denuncia por /me/reports con MUSIC_PLAYLIST: pública ajena sí; propia y privada no", async () => {
    const pub = await request(httpServer).post(url("/music/playlists")).set(as(anaToken))
      .send({ url: `https://open.spotify.com/show/${spotifyId()}`, visibilidad: "PUBLIC" }).expect(201);
    const priv = await request(httpServer).post(url("/music/playlists")).set(as(anaToken))
      .send({ url: `https://open.spotify.com/show/${spotifyId()}`, visibilidad: "PRIVATE" }).expect(201);
    const pubId = (pub.body.data as Playlist).id;
    const privId = (priv.body.data as Playlist).id;
    const reportAs = (token: string, targetId: string) =>
      request(httpServer).post(url("/me/reports")).set(as(token))
        .send({ targetKind: "MUSIC_PLAYLIST", targetId, reason: "SPAM", details: "publicidad" });

    const report = await reportAs(beaToken, pubId).expect(201);
    expect(report.body.data).toEqual(expect.objectContaining({ id: expect.any(String), contentHidden: false }));
    await reportAs(beaToken, pubId).expect(409);
    await reportAs(beaToken, privId).expect(404);
    await reportAs(anaToken, pubId).expect(409);
  });
});
