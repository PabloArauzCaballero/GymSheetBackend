import { AccountExportSection } from "./account-export.sections";

/** The listing of the exporting business account (1:1, ADR-0020). */
const ENTITY = "(SELECT a.entity_id FROM business.accounts a WHERE a.user_id = :userId)";
const OWN_ENTITY = `t.entity_id = ${ENTITY}`;
const OWN_LISTINGS = `SELECT p.id FROM directory.entity_plans p WHERE p.entity_id = ${ENTITY}`;
const OWN_ORDERS = `SELECT o.id FROM directory.payment_orders o WHERE o.entity_id = ${ENTITY}`;
const OWN_AFFILIATIONS = `SELECT a.id FROM directory.affiliations a WHERE a.gym_entity_id = ${ENTITY} OR a.coach_entity_id = ${ENTITY}`;

const section = (key: string, table: string, label: string, where: string, omit?: readonly string[], from?: string): AccountExportSection => ({
  key,
  table,
  label,
  where,
  omit,
  from,
});

/**
 * What a business account's export adds to the account-wide sections
 * (plan §2.14, ADR-0028). Of the people it sold to or affiliated, only the
 * display name: never their account id, their notes to the business, the CI
 * digits of a member or who on either side made each change. Who at REPP
 * moderated a listing is internal too. Its own KYC (identity in clear where it
 * is the owner's and its documents) is built apart by `KycExportReader`.
 */
export const BUSINESS_EXPORT_SECTIONS: readonly AccountExportSection[] = [
  section("business.account", "business.accounts", "Cuenta de negocio", "t.user_id = :userId"),
  section("business.profile", "directory.entities", "Perfil del negocio", `t.id = ${ENTITY}`),
  section("business.handles", "directory.handles", "@usuario", `t.owner_entity_id = ${ENTITY}`),
  section("business.handle_changes", "directory.handle_changes", "Cambios de @usuario", OWN_ENTITY, ["actor_user_id"]),
  section("business.locations", "directory.entity_locations", "Sedes", OWN_ENTITY),
  section("business.listings", "directory.entity_plans", "Publicaciones", OWN_ENTITY, ["moderated_by_user_id"]),
  section("business.price_history", "directory.plan_price_history", "Historial de precios", `t.plan_id IN (${OWN_LISTINGS})`, ["changed_by_user_id"]),
  section("business.payment_config", "directory.entity_payment_configs", "Datos de cobro", OWN_ENTITY, ["qr_private_key"]),
  section("business.orders", "directory.payment_orders", "Pedidos recibidos", OWN_ENTITY,
    ["athlete_user_id", "athlete_notes", "receipt_private_key", "receipt_storage_key", "receipt_sha256", "decided_by_user_id", "verified_by_user_id"],
    `SELECT o.*, u.nombre_completo AS buyer_display_name FROM directory.payment_orders o JOIN public.usuarios u ON u.id = o.athlete_user_id`),
  section("business.order_history", "directory.payment_order_history", "Historial de los pedidos", `t.order_id IN (${OWN_ORDERS})`, ["actor_user_id"]),
  section("business.affiliations", "directory.affiliations", "Socios, coaches y gimnasios vinculados",
    `t.gym_entity_id = ${ENTITY} OR t.coach_entity_id = ${ENTITY}`, ["user_id", "ci_last3", "changed_by_user_id"],
    `SELECT a.*, COALESCE(u.nombre_completo, ce.name) AS subject_display_name, ge.name AS gym_name
       FROM directory.affiliations a
       LEFT JOIN public.usuarios u ON u.id = a.user_id
       LEFT JOIN directory.entities ce ON ce.id = a.coach_entity_id
       JOIN directory.entities ge ON ge.id = a.gym_entity_id`),
  section("business.affiliation_history", "directory.affiliation_history", "Historial de las afiliaciones", `t.affiliation_id IN (${OWN_AFFILIATIONS})`,
    ["actor_user_id"]),
  section("business.subscriptions", "membership.memberships", "Suscripciones vendidas", `${OWN_ENTITY} AND t.origin = 'MARKETPLACE'`,
    ["user_id", "notes", "metadata", "created_by_user_id", "retired_plan_id", "external_reference"],
    `SELECT m.*, u.nombre_completo AS buyer_display_name FROM membership.memberships m JOIN public.usuarios u ON u.id = m.user_id`),
  section("business.kyc_status_history", "business.kyc_status_history", "Historial de tu verificación", "t.account_id = :userId", ["actor_user_id"]),
];
