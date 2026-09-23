/** Static, code-defined permission catalog. Not user-editable via API in this phase. */
export const AdminPermissionKey = {
  CATALOG_READ: 'catalog:read',
  CATALOG_WRITE: 'catalog:write',
  QA_READ: 'qa:read',
  QA_RUN: 'qa:run',
  QA_ADMIN: 'qa:admin',
  DATA_LOADER_RUN: 'data-loader:run',
  DATA_LOADER_ADMIN: 'data-loader:admin',
  FILES_READ: 'files:read',
  FILES_DOWNLOAD: 'files:download',
  MODERATION_READ: 'moderation:read',
  MODERATION_ACT: 'moderation:act',
  SUPPORT_READ: 'support:read',
  SUPPORT_RESPOND: 'support:respond',
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  USERS_DANGER: 'users:danger',
  ANALYTICS_READ: 'analytics:read',
  ANALYTICS_ADMIN: 'analytics:admin',
  ARTIFACTS_READ: 'artifacts:read',
  ARTIFACTS_ADMIN: 'artifacts:admin',
  ADMIN_ACCESS_MANAGE: 'admin-access:manage',
} as const;

export type AdminPermissionKeyValue = (typeof AdminPermissionKey)[keyof typeof AdminPermissionKey];

export type AdminPermissionDomain =
  | 'catalog'
  | 'qa'
  | 'data-loader'
  | 'files'
  | 'moderation'
  | 'support'
  | 'users'
  | 'analytics'
  | 'artifacts'
  | 'admin-access';

export type AdminPermissionDefinition = {
  key: AdminPermissionKeyValue;
  label: string;
  description: string;
  domain: AdminPermissionDomain;
};

export const ADMIN_PERMISSION_CATALOG: readonly AdminPermissionDefinition[] = [
  {
    key: AdminPermissionKey.CATALOG_READ,
    label: 'Ver catálogo de datos',
    description: 'Consultar la metadata de tablas y columnas de la base de datos.',
    domain: 'catalog',
  },
  {
    key: AdminPermissionKey.CATALOG_WRITE,
    label: 'Editar catálogo de datos',
    description: 'Editar descripciones de negocio/sistema y disparar la sincronización del catálogo.',
    domain: 'catalog',
  },
  {
    key: AdminPermissionKey.QA_READ,
    label: 'Ver QA Lab',
    description: 'Consultar endpoints descubiertos, suites y el historial de corridas de QA.',
    domain: 'qa',
  },
  {
    key: AdminPermissionKey.QA_RUN,
    label: 'Ejecutar QA Lab',
    description: 'Ejecutar suites y pruebas de endpoint individuales existentes.',
    domain: 'qa',
  },
  {
    key: AdminPermissionKey.QA_ADMIN,
    label: 'Administrar QA Lab',
    description: 'Crear/editar/borrar suites y autorizar corridas contra producción.',
    domain: 'qa',
  },
  {
    key: AdminPermissionKey.DATA_LOADER_RUN,
    label: 'Ejecutar carga masiva',
    description: 'Cargar datos masivamente en tablas catalogadas como permitidas.',
    domain: 'data-loader',
  },
  {
    key: AdminPermissionKey.DATA_LOADER_ADMIN,
    label: 'Administrar carga masiva',
    description: 'Autorizar cargas masivas contra producción en tablas sensibles.',
    domain: 'data-loader',
  },
  {
    key: AdminPermissionKey.ANALYTICS_READ,
    label: 'Ver analítica',
    description: 'Consultar la configuración y el estado del tracking de analítica.',
    domain: 'analytics',
  },
  {
    key: AdminPermissionKey.ANALYTICS_ADMIN,
    label: 'Administrar analítica',
    description: 'Editar la configuración y la taxonomía de eventos de analítica.',
    domain: 'analytics',
  },
  {
    key: AdminPermissionKey.ARTIFACTS_READ,
    label: 'Ver artefactos',
    description: 'Consultar el feed unificado de artefactos de despliegue y de datos.',
    domain: 'artifacts',
  },
  {
    key: AdminPermissionKey.ARTIFACTS_ADMIN,
    label: 'Administrar artefactos',
    description: 'Confirmar/anotar eventos del feed de artefactos.',
    domain: 'artifacts',
  },
  {
    key: AdminPermissionKey.FILES_READ,
    label: 'Ver archivos',
    description:
      'Explorar los archivos almacenados, sus metadatos y desde dónde se referencian.',
    domain: 'files',
  },
  {
    // Separado de `files:read` porque son dos riesgos distintos: mirar el árbol
    // es administrar; sacar el binario de una story privada fuera del sistema,
    // no. Quien necesita lo primero rara vez necesita lo segundo.
    key: AdminPermissionKey.FILES_DOWNLOAD,
    label: 'Descargar archivos',
    description: 'Descargar el binario original de un archivo almacenado.',
    domain: 'files',
  },
  {
    key: AdminPermissionKey.MODERATION_READ,
    label: 'Ver moderación',
    description: 'Consultar la cola de reportes y el historial de sanciones.',
    domain: 'moderation',
  },
  {
    key: AdminPermissionKey.MODERATION_ACT,
    label: 'Resolver moderación',
    description:
      'Resolver reportes: ocultar contenido, advertir y suspender cuentas.',
    domain: 'moderation',
  },
  {
    key: AdminPermissionKey.SUPPORT_READ,
    label: 'Ver soporte',
    description: 'Consultar la bandeja de tickets de soporte y sus conversaciones.',
    domain: 'support',
  },
  {
    key: AdminPermissionKey.SUPPORT_RESPOND,
    label: 'Atender soporte',
    description: 'Responder, asignar, priorizar y cerrar tickets de soporte.',
    domain: 'support',
  },
  {
    key: AdminPermissionKey.USERS_READ,
    label: 'Ver ficha de usuario',
    description: 'Consultar la ficha completa de una cuenta y su actividad.',
    domain: 'users',
  },
  {
    key: AdminPermissionKey.USERS_MANAGE,
    label: 'Gestionar usuarios',
    description:
      'Activar y desactivar cuentas, emitir restablecimientos de contraseña y revocar sesiones.',
    domain: 'users',
  },
  {
    // Tercer escalón y no parte de `users:manage`: cambiar el rol de una cuenta
    // o anonimizarla no se deshace, y quien atiende el mostrador no necesita
    // poder hacerlo para hacer su trabajo.
    key: AdminPermissionKey.USERS_DANGER,
    label: 'Acciones irreversibles sobre usuarios',
    description: 'Cambiar el rol de una cuenta y anonimizarla.',
    domain: 'users',
  },
  {
    key: AdminPermissionKey.ADMIN_ACCESS_MANAGE,
    label: 'Administrar permisos',
    description: 'Otorgar y revocar permisos granulares de administración a otro personal.',
    domain: 'admin-access',
  },
];
