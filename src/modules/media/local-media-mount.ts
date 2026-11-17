import { Express, static as expressStatic } from 'express';
import { resolve } from 'path';
import { env } from '../../config/env';
import { isContentAddressedMediaPath, isPrivateStoredMediaPath } from './private-media-path';

/**
 * The local media adapter's on-disk root, served under its public base path,
 * with private folders (chats, stories, reels, selfies, KYC documents)
 * refused with 404 before the static handler. Used by `main.ts`, and by the
 * e2e that proves a stored KYC document is not reachable there.
 */
export function mountLocalMedia(application: Express): void {
  const mediaMountPath = new URL(env.MEDIA_STORAGE_PUBLIC_BASE_URL).pathname;
  // Chat media is returned only through the authenticated conversation API.
  // Blocking the local static path also protects old links copied before the
  // encrypted storage format was introduced.
  application.use(mediaMountPath, (request, response, next) => {
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(request.path);
    } catch {
      response.sendStatus(404);
      return;
    }
    if (isPrivateStoredMediaPath(decodedPath)) {
      response.sendStatus(404);
      return;
    }
    next();
  });
  application.use(
    mediaMountPath,
    expressStatic(resolve(env.MEDIA_STORAGE_LOCAL_ROOT), {
      // Las claves son el SHA-256 del contenido (`LocalStorageAdapter`):
      // una URL nunca cambia de bytes, así que el cliente no tiene por qué
      // volver a preguntar. Un fichero con otro nombre no entra en eso
      // (abajo se le quita). Un borrado deja la URL en 404 en el origen; lo
      // ya descargado por un cliente puede seguir en su caché hasta 30 días.
      maxAge: '30d',
      immutable: true,
      setHeaders: (response, filePath) => {
        if (!isContentAddressedMediaPath(filePath)) {
          response.setHeader('Cache-Control', 'no-cache');
        }
        // Sin sniffing: el navegador respeta el Content-Type derivado de la
        // extensión, que ahora sólo puede salir de `MIME_EXTENSION`.
        response.setHeader('X-Content-Type-Options', 'nosniff');
        // Descarga, nunca renderizado en el origen de la API.
        response.setHeader('Content-Disposition', 'attachment');
        // Defensa en profundidad: aunque algo llegara a interpretarse como
        // documento, no puede cargar ni ejecutar nada.
        response.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; sandbox",
        );
      },
    }),
  );
}
