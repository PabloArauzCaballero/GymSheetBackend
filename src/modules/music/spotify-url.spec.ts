import { parseSpotifyEmbedUrl, parseSpotifyUrl } from './spotify-url';

const ID = '37i9dQZF1DXcBWIGoYBM5M';

describe('parseSpotifyUrl', () => {
  it.each(['playlist', 'album', 'track', 'artist', 'show'] as const)('acepta %s y normaliza', (tipo) => {
    expect(parseSpotifyUrl(`https://open.spotify.com/${tipo}/${ID}`)).toEqual({
      url: `https://open.spotify.com/${tipo}/${ID}`,
      tipo,
      id: ID,
    });
  });

  it('quita la query ?si= y el fragmento', () => {
    expect(parseSpotifyUrl(`https://open.spotify.com/playlist/${ID}?si=abc123&utm=x#frag`)?.url).toBe(
      `https://open.spotify.com/playlist/${ID}`,
    );
  });

  it.each(['intl-es', 'intl-pt-br', 'INTL-ES'])('quita el prefijo regional %s', (prefix) => {
    expect(parseSpotifyUrl(`https://open.spotify.com/${prefix}/album/${ID}?si=1`)).toEqual({
      url: `https://open.spotify.com/album/${ID}`,
      tipo: 'album',
      id: ID,
    });
  });

  it('acepta espacios alrededor, barra final y el formato antiguo /user/<nombre>/playlist', () => {
    expect(parseSpotifyUrl(`  https://open.spotify.com/track/${ID}/  `)?.url).toBe(`https://open.spotify.com/track/${ID}`);
    expect(parseSpotifyUrl(`https://open.spotify.com/user/spotify/playlist/${ID}`)?.url).toBe(
      `https://open.spotify.com/playlist/${ID}`,
    );
  });

  it('acepta los enlaces cortos spotify.link sin resolver id', () => {
    expect(parseSpotifyUrl('https://spotify.link/AbC123xyz?si=1')).toEqual({
      url: 'https://spotify.link/AbC123xyz',
      tipo: 'playlist',
      id: null,
    });
  });

  it.each([
    ['http, no https', `http://open.spotify.com/playlist/${ID}`],
    ['otro host', `https://evil.example.com/playlist/${ID}`],
    ['subdominio parecido', `https://open.spotify.com.evil.com/playlist/${ID}`],
    ['host de Spotify no admitido', `https://play.spotify.com/playlist/${ID}`],
    ['tipo no admitido', `https://open.spotify.com/episode/${ID}`],
    ['id con longitud incorrecta', 'https://open.spotify.com/playlist/abc'],
    ['id con caracteres raros', `https://open.spotify.com/playlist/${ID.slice(0, 21)}!`],
    ['sin id', 'https://open.spotify.com/playlist'],
    ['segmentos de más', `https://open.spotify.com/playlist/${ID}/extra`],
    ['uri spotify:', `spotify:playlist:${ID}`],
    ['credenciales en la url', `https://user:pass@open.spotify.com/playlist/${ID}`],
    ['puerto explícito', `https://open.spotify.com:8443/playlist/${ID}`],
    ['enlace corto vacío', 'https://spotify.link/'],
    ['enlace corto con ruta', 'https://spotify.link/a/b'],
    ['texto libre', 'mi playlist favorita'],
    ['vacío', ''],
    ['demasiado largo', `https://open.spotify.com/playlist/${ID}?si=${'a'.repeat(600)}`],
  ])('rechaza %s', (_label, input) => {
    expect(parseSpotifyUrl(input)).toBeNull();
  });
});

describe('parseSpotifyEmbedUrl', () => {
  it('resuelve el iframe_url de oEmbed', () => {
    expect(parseSpotifyEmbedUrl(`https://open.spotify.com/embed/album/${ID}?utm_source=oembed`)).toEqual({
      url: `https://open.spotify.com/album/${ID}`,
      tipo: 'album',
      id: ID,
    });
  });

  it('devuelve null si no hay id o no es texto', () => {
    expect(parseSpotifyEmbedUrl(undefined)).toBeNull();
    expect(parseSpotifyEmbedUrl('https://spotify.link/abc')).toBeNull();
    expect(parseSpotifyEmbedUrl('https://example.com/embed/album/x')).toBeNull();
  });
});
