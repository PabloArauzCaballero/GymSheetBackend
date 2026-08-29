import { TenantModel } from "./tenant.model";

/** Forma pública de un gimnasio. `id` ES el slug: una sola fuente de identidad. */
export type TenantResponse = {
  id: string;
  nombre: string;
  activo: boolean;
};

export function mapTenantToResponse(tenant: TenantModel): TenantResponse {
  return {
    id: tenant.id,
    nombre: tenant.nombre,
    // Se expone como booleano y no como el literal de estado: quien consume
    // esto sólo necesita saber si el gimnasio admite operación, y un enum de
    // dos valores en el contrato invita a que crezca sin control.
    activo: tenant.estado === "ACTIVO",
  };
}
