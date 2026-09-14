/**
 * El `endpoint` de una suscripción Web Push lo elige el NAVEGADOR y llega en el
 * cuerpo de una petición autenticada, así que para el servidor es una URL
 * arbitraria enviada por un cliente: exactamente la forma de un SSRF. Sin este
 * filtro, registrar `http://169.254.169.254/...` bastaría para que el backend
 * hiciera peticiones a la red interna cada vez que se emite un aviso.
 *
 * Por eso la comprobación es una allowlist de hosts de servicios de push
 * (regla `30-security`, el mismo criterio que `NOTIFICATION_GATEWAY_ALLOWED_HOSTS`
 * y `MEDIA_MIRROR_ALLOWED_HOSTS`) y no una lista negra: un navegador nuevo se
 * añade explícitamente a la configuración, que es una decisión de despliegue, y
 * no se cuela solo.
 *
 * La coincidencia es por host exacto, igual que en el resto del repositorio.
 */
export function isAllowedWebPushEndpoint(
  endpoint: string,
  allowedHosts: readonly string[],
): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  // HTTPS obligatorio: el protocolo Web Push no admite otra cosa, y aceptarla
  // aquí sería aceptar un destino en texto claro dentro de la red del servidor.
  if (url.protocol !== 'https:') return false;
  return allowedHosts.includes(url.hostname);
}
