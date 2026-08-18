import { MembershipStatus } from "../../common/enums/domain.enums";
import { BusinessDateService } from "../../common/time/business-date.service";
import { CustomerProfileModel } from "./customer-profile.model";
import { MembershipFeatureModel } from "./membership-feature.model";
import { MembershipPlanModel } from "./membership-plan.model";
import { MembershipModel } from "./membership.model";
import { StaffProfileModel } from "./staff-profile.model";

export function mapFeature(feature: MembershipFeatureModel) {
  return {
    id: feature.id,
    code: feature.code,
    nombre: feature.name,
    descripcion: feature.description,
    estado: feature.status,
  };
}

export function mapPlan(plan: MembershipPlanModel) {
  return {
    id: plan.id,
    publicId: plan.publicId,
    codigo: plan.code,
    nombre: plan.name,
    descripcion: plan.description,
    tipo: plan.planType,
    duracionDias: plan.durationDays,
    diasRecordatorio: plan.reminderDays,
    estado: plan.status,
    precio: plan.priceAmount === null ? null : Number(plan.priceAmount),
    moneda: plan.currency,
    beneficios: plan.benefits,
    orden: plan.displayOrder,
    disponibleNuevo: plan.availableNew,
    disponibleRenovacion: plan.availableRenewal,
    disponibleExtension: plan.availableExtension,
    imagen: plan.image
      ? {
          id: plan.image.id,
          publicId: plan.image.publicId,
          url: plan.image.storageUrl ?? plan.image.sourceUrl,
          altText: plan.image.altText,
          width: plan.image.width,
          height: plan.image.height,
          licencia: plan.image.license,
          atribucion: plan.image.attribution,
        }
      : null,
    alcances: (plan.accessScopes ?? []).map((scope) => ({
      sedeId: scope.branchId,
      salaId: scope.roomId,
    })),
    metadata: plan.metadata,
  };
}

export function mapMembership(
  membership: MembershipModel,
  dates: BusinessDateService,
) {
  const today = dates.today();
  const daysRemaining = dates.daysBetween(today, membership.endsOn);
  return {
    id: membership.id,
    clienteUsuarioId: membership.userId,
    planId: membership.planId,
    plan: membership.plan ? mapPlan(membership.plan) : undefined,
    iniciaEl: membership.startsOn,
    venceEl: membership.endsOn,
    estado: membership.status,
    diasRestantes: Math.max(0, daysRemaining),
    venceHoy: daysRemaining === 0,
    vigenteHoy:
      dates.isWithin(today, membership.startsOn, membership.endsOn) &&
      membership.status === MembershipStatus.ACTIVE,
    referenciaExterna: membership.externalReference,
    notas: membership.notes,
  };
}

export function mapCustomer(profile: CustomerProfileModel) {
  return {
    id: profile.id,
    usuarioId: profile.userId,
    numeroCliente: profile.customerNumber,
    telefono: profile.phoneNumber,
    registradoEl: profile.joinedOn,
    referenciaExterna: profile.externalReference,
    notas: profile.notes,
    usuario: profile.user
      ? {
          id: profile.user.id,
          email: profile.user.email,
          nombreCompleto: profile.user.fullName,
          estado: profile.user.status,
        }
      : undefined,
  };
}

export function mapStaff(profile: StaffProfileModel) {
  return {
    id: profile.id,
    usuarioId: profile.userId,
    cargo: profile.position,
    estadoLaboral: profile.employmentStatus,
    contratadoEl: profile.hiredOn,
    terminadoEl: profile.terminatedOn,
    accesoIlimitado: profile.unlimitedAccess,
    sedes: (profile.branchScopes ?? []).map((scope) => scope.branchId),
    // Sólo se proyecta si la consulta incluyó la cuenta; el alta por
    // `usuarioId` no la carga y la clave queda ausente, no nula.
    usuario: profile.user
      ? {
          id: profile.user.id,
          email: profile.user.email,
          nombreCompleto: profile.user.fullName,
          rol: profile.user.role,
          estado: profile.user.status,
        }
      : undefined,
  };
}
