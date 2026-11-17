import { SetMetadata } from "@nestjs/common";

export const SKIP_LEGAL_ACCEPTANCE_KEY = "skipLegalAcceptance";

/** Opts a route (or controller) out of the global legal-acceptance check. */
export const SkipLegalAcceptance = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(SKIP_LEGAL_ACCEPTANCE_KEY, true);
