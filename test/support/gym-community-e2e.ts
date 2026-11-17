import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/**
 * A CONFIRMED SOCIO written straight to the database, for suites that only
 * need «the person has a gym» (ADR-0027) and not the request flow, which
 * `test/affiliations.e2e-spec.ts` covers. Creates a GYM entity with one
 * location unless `gymEntityId` is given. Returns the gym entity id.
 */
export async function seedConfirmedSocio(sequelize: Sequelize, userId: string, gymEntityId?: string): Promise<string> {
  const gymId = gymEntityId ?? (await seedGymEntity(sequelize));
  const [location] = await sequelize.query<{ id: string }>(
    'SELECT id FROM directory.entity_locations WHERE entity_id = :gymId ORDER BY display_order, id LIMIT 1',
    { type: QueryTypes.SELECT, replacements: { gymId } },
  );
  await sequelize.query(
    `INSERT INTO directory.affiliations (gym_entity_id, user_id, kind, status, location_id, ci_last3, confirmed_at)
     VALUES (:gymId, :userId, 'SOCIO', 'CONFIRMED', :locationId, '123', now())`,
    { replacements: { gymId, userId, locationId: location.id } },
  );
  return gymId;
}

export async function seedGymEntity(sequelize: Sequelize): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  const [gym] = await sequelize.query<{ id: string }>(
    `INSERT INTO directory.entities (slug, entity_type, name, name_skeleton, status, primary_category_id)
     VALUES (:slug, 'GYM', :name, :slug, 'ACTIVE', (SELECT id FROM directory.categories WHERE entity_scope = 'GYM' ORDER BY path LIMIT 1))
     RETURNING id`,
    { type: QueryTypes.SELECT, replacements: { slug: `gym-e2e-${tag}`, name: `Gimnasio ${tag}` } },
  );
  await sequelize.query(`INSERT INTO directory.entity_locations (entity_id, name) VALUES (:id, 'Sede Única')`, { replacements: { id: gym.id } });
  return gym.id;
}
