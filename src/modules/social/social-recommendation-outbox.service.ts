import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { GymDomainEvent } from "../integration/domain-event.catalog";
import { DomainEventPublisher } from "../integration/domain-event.publisher";

type SocialProfileSnapshot = {
  id: string;
  active: boolean;
  profile_enabled: boolean;
  age: number | null;
  gender: "MALE" | "FEMALE" | "UNSPECIFIED" | null;
  goal: string | null;
  intents: ("TRAINING" | "FRIENDSHIP" | "DATING")[] | null;
  lat: number | null;
  lon: number | null;
  suspended: boolean;
};

@Injectable()
export class SocialRecommendationOutboxService {
  constructor(private readonly sequelize: Sequelize, private readonly events: DomainEventPublisher) {}

  async lockProfileForUpdate(userId: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query("SELECT id FROM public.usuarios WHERE id = :userId FOR UPDATE", {
      type: QueryTypes.SELECT, replacements: { userId }, transaction,
    });
  }

  async enqueueProfileSnapshot(userId: string, transaction: Transaction): Promise<void> {
    await this.lockProfileForUpdate(userId, transaction);
    const snapshots = await this.sequelize.query<SocialProfileSnapshot>(
      `SELECT account.id, account.estado = 'ACTIVO' AS active,
              COALESCE(settings.profile_enabled, FALSE) AS profile_enabled,
              COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, anthropometric.fecha_nacimiento))::int, anthropometric.edad) AS age,
              account.genero AS gender,
              anthropometric.objetivo AS goal,
              preferences.intents,
              branch.latitude::float8 AS lat,
              branch.longitude::float8 AS lon,
              (account.suspended_until IS NOT NULL AND account.suspended_until > NOW()) AS suspended
         FROM public.usuarios account
         LEFT JOIN social.profile_settings settings ON settings.user_id = account.id
         LEFT JOIN public.perfiles_antropometricos anthropometric ON anthropometric.usuario_id = account.id
         LEFT JOIN social.discovery_preferences preferences ON preferences.user_id = account.id
         LEFT JOIN facilities.branches branch ON branch.id = account.sede_id AND branch.status = 'ACTIVE'
        WHERE account.id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
    const snapshot = snapshots[0];
    if (!snapshot) return;

    const versions = await this.sequelize.query<{ version: number | string }>(
      `INSERT INTO social.recommendation_profile_versions (user_id, version)
       VALUES (:userId, 1)
       ON CONFLICT (user_id) DO UPDATE SET version = social.recommendation_profile_versions.version + 1, updated_at = NOW()
       RETURNING version`,
      { type: QueryTypes.SELECT, replacements: { userId }, transaction },
    );
    const aggregateVersion = Number(versions[0]?.version);
    if (!Number.isInteger(aggregateVersion) || aggregateVersion < 1) throw new Error("Recommendation profile version could not be advanced.");

    const eligible = snapshot.active && snapshot.profile_enabled && !snapshot.suspended &&
      Number.isInteger(snapshot.age) && (snapshot.age as number) >= 18 &&
      (snapshot.gender === "MALE" || snapshot.gender === "FEMALE") &&
      snapshot.intents !== null && snapshot.lat !== null && snapshot.lon !== null;

    if (!eligible) {
      await this.events.recordAndEnqueue({
        eventName: GymDomainEvent.SOCIAL_PROFILE_DELETED,
        aggregateType: "social.profile",
        aggregateId: userId,
        actorUserId: userId,
        deduplicationKey: `social-profile:${userId}:${aggregateVersion}`,
        payload: { userId, aggregateVersion, schemaVersion: 1 },
      }, [{
        queueName: "recommendations.projection",
        deduplicationKey: `social-profile:${userId}:${aggregateVersion}`,
        payload: { aggregateVersion, schemaVersion: 1, profile: null },
      }], transaction);
      return;
    }

    const profile = {
      id: snapshot.id,
      active: true,
      complete: true,
      suspended: false,
      age: snapshot.age as number,
      gender: snapshot.gender === "MALE" ? "MAN" : "WOMAN",
      intents: snapshot.intents ?? [],
      interests: [],
      goals: snapshot.goal ? [snapshot.goal] : [],
      availability: [],
      area: { lat: snapshot.lat as number, lon: snapshot.lon as number },
      blockedIds: [],
      connectedIds: [],
      passedIds: [],
    };
    await this.events.recordAndEnqueue({
      eventName: GymDomainEvent.SOCIAL_PROFILE_UPDATED,
      aggregateType: "social.profile",
      aggregateId: userId,
      actorUserId: userId,
      deduplicationKey: `social-profile:${userId}:${aggregateVersion}`,
      payload: { userId, aggregateVersion, schemaVersion: 1, profile },
    }, [{
      queueName: "recommendations.projection",
      deduplicationKey: `social-profile:${userId}:${aggregateVersion}`,
      payload: { aggregateVersion, schemaVersion: 1, profile },
    }], transaction);
  }
}
