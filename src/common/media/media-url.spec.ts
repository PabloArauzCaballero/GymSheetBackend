import { resolveMediaUrl, resolveMediaUrls } from './media-url';
import { env } from '../../config/env';

describe('media-url transversal helper', () => {
  it('retorna null para valores vacíos o indefinidos', () => {
    expect(resolveMediaUrl(null)).toBeNull();
    expect(resolveMediaUrl(undefined)).toBeNull();
    expect(resolveMediaUrl('')).toBeNull();
    expect(resolveMediaUrl('   ')).toBeNull();
  });

  it('respeta URLs absolutas ya formadas con https:// o http://', () => {
    expect(resolveMediaUrl('https://cdn.example.com/photo.jpg')).toBe(
      'https://cdn.example.com/photo.jpg'
    );
    expect(resolveMediaUrl('http://storage.local/avatar.png')).toBe(
      'http://storage.local/avatar.png'
    );
  });

  it('resuelve rutas relativas contra MEDIA_STORAGE_PUBLIC_BASE_URL', () => {
    const base = env.MEDIA_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, '');
    expect(resolveMediaUrl('perfiles/user-1/avatar.jpg')).toBe(
      `${base}/perfiles/user-1/avatar.jpg`
    );
    expect(resolveMediaUrl('/perfiles/user-1/avatar.jpg')).toBe(
      `${base}/perfiles/user-1/avatar.jpg`
    );
  });

  it('resuelve listas de URLs descartando elementos inválidos', () => {
    const base = env.MEDIA_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, '');
    const resolved = resolveMediaUrls([
      'perfiles/1.jpg',
      null,
      'https://external.com/2.jpg',
      '',
      undefined,
    ]);
    expect(resolved).toEqual([
      `${base}/perfiles/1.jpg`,
      'https://external.com/2.jpg',
    ]);
  });
});
