// E2E suites register many synthetic users in one process; keep the auth
// limiter from masking the behavior under test. An explicit CI override wins.
process.env.AUTH_RATE_LIMIT_MAX ??= "100";
// Signup anti-bot layer (ADR-0013). The shared `register` helper fetches a real
// ticket; the many suites that post /auth/register directly predate tickets,
// so enforcement is off here and test/antibot-signup.e2e-spec.ts turns it on.
// Per-IP/domain limits would otherwise trip on suites that create many users.
process.env.SIGNUP_TICKET_REQUIRED ??= "false";
process.env.SIGNUP_MIN_FILL_MS ??= "0";
process.env.SIGNUP_LIMIT_PER_IP_HOUR ??= "100000";
process.env.SIGNUP_LIMIT_PER_INSTALLATION_DAY ??= "100000";
process.env.SIGNUP_LIMIT_PER_EMAIL_DOMAIN_HOUR ??= "100000";
