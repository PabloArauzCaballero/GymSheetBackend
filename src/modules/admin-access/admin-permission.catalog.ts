/** Static, code-defined permission catalog. Not user-editable via API in this phase. */
export const AdminPermissionKey = {
  CATALOG_READ: 'catalog:read',
  CATALOG_WRITE: 'catalog:write',
  QA_READ: 'qa:read',
  QA_RUN: 'qa:run',
  QA_ADMIN: 'qa:admin',
  DATA_LOADER_RUN: 'data-loader:run',
  DATA_LOADER_ADMIN: 'data-loader:admin',
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
    key: AdminPermissionKey.ADMIN_ACCESS_MANAGE,
    label: 'Administrar permisos',
    description: 'Otorgar y revocar permisos granulares de administración a otro personal.',
    domain: 'admin-access',
  },
];
