import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { NotificationChannel, RefreshTokenRevokedReason } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { NotificationService } from "../notifications/notification.service";
import { ClientDeviceContext } from "./client-device-context";
import { describeDevice, mapUserDevice, UserDeviceResponse } from "./user-device.mapper";
import { UserDeviceRepository } from "./user-device.repository";

const MAX_LISTED_DEVICES = 50;

/**
 * Registry of the installations an account signs in from. A credential
 * sign-in without an `X-Installation-Id` gets a server-assigned one, so every
 * new session is bound to a device that the owner can see and revoke.
 */
@Injectable()
export class UserDeviceService {
  constructor(
    private readonly devices: UserDeviceRepository,
    private readonly notifications: NotificationService,
    private readonly sequelize: Sequelize,
  ) {}

  /** Signup: the account's first device, so there is nothing to alert about. */
  async recordSignup(userId: string, context: ClientDeviceContext, transaction: Transaction): Promise<string> {
    const device = await this.devices.upsert(userId, installationOf(context), context, { reactivate: true }, transaction);
    return device.id;
  }

  /**
   * Credential sign-in (password, Google, Apple). An installation never seen
   * for an account that already has devices triggers the "new sign-in" email,
   * enqueued in the same transaction as the session.
   */
  async recordSignIn(userId: string, context: ClientDeviceContext, transaction: Transaction): Promise<string> {
    const device = await this.devices.upsert(userId, installationOf(context), context, { reactivate: true }, transaction);
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

  /**
   * "Sign out everywhere else": every device but the caller's, and every
   * session not bound to it. Without a known current device, everything ends.
   */
  async revokeOthers(userId: string, current: { deviceId: string | null; installationId: string | null }): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      // The session's own device (from the token) wins; the header is the fallback for older tokens.
      const keepDeviceId =
        current.deviceId ??
        (current.installationId
          ? ((await this.devices.findActiveByInstallation(userId, current.installationId, transaction))?.id ?? null)
          : null);
      await this.devices.revokeAllExcept(userId, keepDeviceId, RefreshTokenRevokedReason.DEVICE_REVOKED, transaction);
    });
  }

  /** Ends every session and device of the account (identity takeover, compromise). */
  async endAllSessions(userId: string, reason: RefreshTokenRevokedReason, transaction: Transaction): Promise<void> {
    await this.devices.revokeAllExcept(userId, null, reason, transaction);
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

/** The client's installation id, or a fresh server-assigned one for clients that send none. */
function installationOf(context: ClientDeviceContext): string {
  return context.installationId ?? randomUUID();
}
