import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { RefreshTokenRevokedReason } from "../../common/enums/domain.enums";
import { ClientDeviceContext } from "./client-device-context";

export type UserDeviceRow = {
  id: string;
  installationId: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  deviceModel: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

export type UpsertedDevice = { id: string; revokedAt: Date | null; inserted: boolean };

const DEVICE_COLUMNS = `id, installation_id AS "installationId", platform,
  os_version AS "osVersion", app_version AS "appVersion", device_model AS "deviceModel",
  first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt", revoked_at AS "revokedAt"`;

/** Data access for `auth.user_devices` and the device binding of refresh tokens. */
@Injectable()
export class UserDeviceRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * Inserts or refreshes the device of `(user, installation)`. Telemetry only
   * overwrites with values the client actually sent. `reactivate` clears a
   * revocation: a fresh credential check re-authorizes the device, a refresh
   * never does.
   */
  async upsert(
    userId: string,
    installationId: string,
    context: ClientDeviceContext,
    options: { reactivate: boolean },
    transaction: Transaction,
  ): Promise<UpsertedDevice> {
    const [row] = await this.sequelize.query<UpsertedDevice>(
      `INSERT INTO auth.user_devices AS device
         (user_id, installation_id, platform, os_version, app_version, device_model, user_agent, last_ip_hmac)
       VALUES (:userId, :installationId, :platform, :osVersion, :appVersion, :deviceModel, :userAgent, :ipHmac)
       ON CONFLICT (user_id, installation_id) DO UPDATE SET
         platform = CASE WHEN EXCLUDED.platform = 'UNKNOWN' THEN device.platform ELSE EXCLUDED.platform END,
         os_version = COALESCE(EXCLUDED.os_version, device.os_version),
         app_version = COALESCE(EXCLUDED.app_version, device.app_version),
         device_model = COALESCE(EXCLUDED.device_model, device.device_model),
         user_agent = COALESCE(EXCLUDED.user_agent, device.user_agent),
         last_ip_hmac = COALESCE(EXCLUDED.last_ip_hmac, device.last_ip_hmac),
         last_seen_at = now(),
         revoked_at = CASE WHEN :reactivate THEN NULL ELSE device.revoked_at END
       RETURNING id, revoked_at AS "revokedAt", (xmax = 0) AS inserted`,
      {
        type: QueryTypes.SELECT,
        transaction,
        replacements: {
          userId,
          installationId,
          platform: context.platform,
          osVersion: context.osVersion,
          appVersion: context.appVersion,
          deviceModel: context.deviceModel,
          userAgent: context.userAgent,
          ipHmac: context.ipHmac,
          reactivate: options.reactivate,
        },
      },
    );
    if (!row) throw new Error("Device upsert returned no row.");
    return row;
  }

  async countOtherDevices(userId: string, deviceId: string, transaction: Transaction): Promise<number> {
    const [row] = await this.sequelize.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM auth.user_devices WHERE user_id = :userId AND id <> :deviceId`,
      { type: QueryTypes.SELECT, replacements: { userId, deviceId }, transaction },
    );
    return row?.total ?? 0;
  }

  async findById(deviceId: string, transaction?: Transaction): Promise<UserDeviceRow | null> {
    const [row] = await this.sequelize.query<UserDeviceRow>(
      `SELECT ${DEVICE_COLUMNS} FROM auth.user_devices WHERE id = :deviceId`,
      { type: QueryTypes.SELECT, replacements: { deviceId }, transaction },
    );
    return row ?? null;
  }

  /** Active devices of the account, most recent first; bounded, accounts have a handful. */
  listActive(userId: string, limit: number): Promise<UserDeviceRow[]> {
    return this.sequelize.query<UserDeviceRow>(
      `SELECT ${DEVICE_COLUMNS} FROM auth.user_devices
        WHERE user_id = :userId AND revoked_at IS NULL
        ORDER BY last_seen_at DESC
        LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { userId, limit } },
    );
  }

  async touch(deviceId: string, ipHmac: string | null, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE auth.user_devices
          SET last_seen_at = now(), last_ip_hmac = COALESCE(:ipHmac, last_ip_hmac)
        WHERE id = :deviceId`,
      { type: QueryTypes.UPDATE, replacements: { deviceId, ipHmac }, transaction },
    );
  }

  /** Revokes an active device of this owner. Returns false when it is not theirs (or already gone). */
  async revokeOwned(userId: string, deviceId: string, transaction: Transaction): Promise<boolean> {
    const [rows] = await this.sequelize.query(
      `UPDATE auth.user_devices SET revoked_at = now()
        WHERE id = :deviceId AND user_id = :userId AND revoked_at IS NULL
        RETURNING id`,
      { replacements: { userId, deviceId }, transaction },
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  async revokeDeviceSessions(deviceId: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE auth.refresh_tokens SET revoked_at = now(), revoked_reason = :reason
        WHERE device_id = :deviceId AND revoked_at IS NULL`,
      {
        type: QueryTypes.UPDATE,
        replacements: { deviceId, reason: RefreshTokenRevokedReason.DEVICE_REVOKED },
        transaction,
      },
    );
  }
}
