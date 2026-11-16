/**
 * The product's name as people read it in emails and texts. The ONLY place it
 * is spelled: technical identifiers (JWT issuer, metric names, database and
 * package names) keep their own values on purpose.
 */
export const PRODUCT_NAME = "REPP";

/**
 * Tenant created by migration 202608290001 as the platform's reference gym.
 * Its stored name is the old product name, so it never brands an email.
 */
export const PLATFORM_TENANT_ID = "default";

/** The gym's display name when there is one, otherwise the product name. */
export function brandNameOf(tenantDisplayName: string | null | undefined): string {
  const name = tenantDisplayName?.trim();
  return name ? name : PRODUCT_NAME;
}
