import { env } from '../../config/env';

/**
 * Resuelve una URL de recurso multimedia asegurando que provenga de la
 * constante transversal `env.MEDIA_STORAGE_PUBLIC_BASE_URL`.
 *
 * Reglas:
 * 1. Si `url` es nulo, indefinido o cadena vacía, retorna `null`.
 * 2. Si ya es una URL absoluta HTTP(S), se respeta y retorna intacta.
 * 3. Si es una ruta relativa o clave de storage, se concatena limpiamente
 *    con la constante transversal `MEDIA_STORAGE_PUBLIC_BASE_URL`.
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = env.MEDIA_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, '');
  const path = trimmed.replace(/^\/+/, '');
  return `${base}/${path}`;
}

/**
 * Resuelve una lista de URLs de recursos multimedia de forma transversal.
 */
export function resolveMediaUrls(urls: (string | null | undefined)[] | null | undefined): string[] {
  if (!Array.isArray(urls)) return [];
  return urls
    .map((item) => resolveMediaUrl(item))
    .filter((item): item is string => Boolean(item));
}
