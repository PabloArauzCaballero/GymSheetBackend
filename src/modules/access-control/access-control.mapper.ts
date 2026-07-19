import { AccessDecisionModel } from './access-decision.model';
import { AccessDeviceEventModel } from './access-device-event.model';
import { AccessDeviceModel } from './access-device.model';

export function mapDevice(device: AccessDeviceModel) {
  return {
    id: device.id,
    puntoAccesoId: device.accessPointId,
    adapterKey: device.adapterKey,
    dispositivoExternoId: device.externalDeviceId,
    nombre: device.name,
    estado: device.status,
    vistoPorUltimaVezEn: device.lastSeenAt,
    metadata: device.metadata,
  };
}

export function mapDecision(decision: AccessDecisionModel) {
  return {
    id: decision.id,
    eventoDispositivoId: decision.deviceEventId,
    usuarioId: decision.userId,
    resultado: decision.outcome,
    razon: decision.reasonCode,
    membresiaId: decision.membershipId,
    perfilPersonalId: decision.staffProfileId,
    diasRestantes: decision.daysRemaining,
    decididoEn: decision.decidedAt,
    versionPolitica: decision.policyVersion,
  };
}

export function mapEvent(event: AccessDeviceEventModel) {
  return {
    id: event.id,
    dispositivoId: event.deviceId,
    eventoOrigenId: event.sourceEventId,
    credencialId: event.credentialId,
    direccion: event.requestedDirection,
    ocurridoEn: event.occurredAt,
    recibidoEn: event.receivedAt,
    estadoCola: event.queueStatus,
    decision: event.decision ? mapDecision(event.decision) : null,
  };
}
