import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { NotificationChannel } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { NotificationService } from "../notifications/notification.service";
import { ClientDeviceContext } from "./client-device-context";
import { describeDevice, mapUserDevice, UserDeviceResponse } from "./user-device.mapper";
import { UserDeviceRepository } from "./user-device.repository";

const MAX_LISTED_DEVICES = 50;

/**
 * Registry of the installations an account signs in from. A device without an
 * `X-Installation-Id` is not recorded and its sessions stay unbound (legacy
 * behaviour): binding needs an id the client keeps across launches.
 */
@Injectable()
export class UserDeviceService {
  constructor(
    private readonly devices: UserDeviceRepository,
    private readonly notifications: NotificationService,
    private readonly sequelize: Sequelize,
  ) {}

  /** Signup: the account's first device, so there is nothing to alert about. */
  async recordSignup(userId: string, context: ClientDeviceContext, transaction: Transaction): Promise<string | null> {
    if (!context.installationId) return null;
    const device = await this.devices.upsert(userId, context.installationId, context, { reactivate: true }, transaction);
    return device.id;
  }

  /**
   * Credential sign-in (password, Google, Apple). An installation never seen
   * for an account that already has devices triggers the "new sign-in" email,
   * enqueued in the same transaction as the session.
   */
  async recordSignIn(userId: string, context: ClientDeviceContext, transaction: Transaction): Promise<string | null> {
    if (!context.installationId) return null;
    const device = await this.devices.upsert(userId, context.installationId, context, { reactivate: true }, transaction);
    if (device.inserted && (await this.devices.countOtherDevices(userId, device.id, transaction)) > 0) {
      await this.enqueueNewDeviceAlert(userId, device.id, context, transaction);
    }
    return device.id;
  }

  /**
   * Refresh: the session keeps its device. A revoked device ends the session;
   * a legacy unbound session gets bound to the installation it presents now.
   */
  async resolveForRefresh(
    userId: string,
    boundDeviceId: string | null,
    context: ClientDeviceContext,
    transaction: Transaction,
  ): Promise<string | null> {
    if (boundDeviceId) {
      const device = await this.devices.findById(boundDeviceId, transaction);
      if (!device || device.revokedAt) throw new UnauthorizedException("Sesión inválida.");
      await this.devices.touch(boundDeviceId, context.ipHmac, transaction);
      return boundDeviceId;
    }
    if (!context.installationId) return null;
    const device = await this.devices.upsert(userId, context.installationId, context, { reactivate: false }, transaction);
    if (device.revokedAt) throw new UnauthorizedException("Sesión inválida.");
    return device.id;
  }

  async listMine(userId: string, currentInstallationId: string | null): Promise<UserDeviceResponse[]> {
    const rows = await this.devices.listActive(userId, MAX_LISTED_DEVICES);
    return rows.map((row) => mapUserDevice(row, currentInstallationId));
  }

  /** Foreign or unknown ids answer 404, never 403: existence is not disclosed. */
  async revokeMine(userId: string, deviceId: string): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const revoked = await this.devices.revokeOwned(userId, deviceId, transaction);
      if (!revoked) throw new NotFoundException("Dispositivo no encontrado.");
      await this.devices.revokeDeviceSessions(deviceId, transaction);
    });
  }

  private async enqueueNewDeviceAlert(
    userId: string,
    deviceId: string,
    context: ClientDeviceContext,
    transaction: Transaction,
  ): Promise<void> {
    // Approximate time in the business zone; the IP is deliberately left out.
    const when = new Intl.DateTimeFormat("es", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: env.BUSINESS_TIME_ZONE,
    }).format(new Date());
    await this.notifications.enqueueDirectMessage(
      {
        recipientUserId: userId,
        channel: NotificationChannel.EMAIL,
        subject: "Nuevo inicio de sesión",
        body: [
          `Se inició sesión en tu cuenta de GymSheet desde un dispositivo nuevo: ${describeDevice(context)}.`,
          `Fecha aproximada: ${when}.`,
          "",
          "Si fuiste tú, no tienes que hacer nada.",
          "Si no fuiste tú, cambia tu contraseña y cierra la sesión de ese dispositivo en Ajustes > Dispositivos.",
        ].join("\n"),
        deduplicationKey: `new-device-${deviceId}`,
      },
      transaction,
    );
  }
}
